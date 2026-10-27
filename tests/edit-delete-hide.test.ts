import { describe, expect, test } from "bun:test";
import { InMemoryStore } from "../src/adapters/memory/store";
import { createSession } from "../src/app/session";
import { canDelete, deleteFor } from "../src/app/usecases/delete";
import { canEdit, editFor } from "../src/app/usecases/edit";
import type { Message } from "../src/domain/types";
import { SELF_AUTHOR_ID } from "../src/domain/types";
import { DIRECT_ID, FakeBackend, message } from "./helpers/session-fakes";

/**
 * Editing and deleting our own message: who is allowed, what the rule refuses, and what the
 * session does with the answer.
 *
 * The refusals matter as much as the sends. An edit that names somebody else's message would
 * rewrite their words where every other client can see it, and a second delete-for-everyone
 * sends an envelope for a message that is already gone.
 */

const mine = (over: Partial<Message> = {}): Message => ({
	id: `${DIRECT_ID}:1000`,
	conversationId: DIRECT_ID,
	author: "You",
	authorId: SELF_AUTHOR_ID,
	body: "hello",
	sentAt: 1_000,
	isOutgoing: true,
	isDeleted: false,
	attachments: [],
	...over,
});

const theirs = (over: Partial<Message> = {}): Message =>
	mine({ isOutgoing: false, author: "Alice", authorId: "uuid-alice", ...over });

describe("canEdit / canDelete", () => {
	test("our own message, still there", () => {
		expect(canEdit(mine(), DIRECT_ID)).toBe(true);
		expect(canDelete(mine(), DIRECT_ID)).toBe(true);
	});

	test("someone else's message is never ours to change", () => {
		expect(canEdit(theirs(), DIRECT_ID)).toBe(false);
		expect(canDelete(theirs(), DIRECT_ID)).toBe(false);
	});

	test("a deleted row is not edited or deleted again", () => {
		expect(canEdit(mine({ isDeleted: true }), DIRECT_ID)).toBe(false);
		expect(canDelete(mine({ isDeleted: true }), DIRECT_ID)).toBe(false);
	});

	test("an expired row is gone on purpose", () => {
		expect(canEdit(mine({ isExpired: true }), DIRECT_ID)).toBe(false);
		expect(canDelete(mine({ isExpired: true }), DIRECT_ID)).toBe(false);
	});

	test("a view-once message may be deleted, but never edited", () => {
		// The body was never kept, so there is nothing to correct — but the row exists and can
		// be removed from the other side.
		expect(canEdit(mine({ isViewOnce: true }), DIRECT_ID)).toBe(false);
		expect(canDelete(mine({ isViewOnce: true }), DIRECT_ID)).toBe(true);
	});

	test("a row from another conversation is not edited through the wrong one", () => {
		expect(canEdit(mine({ conversationId: "uuid-other" }), DIRECT_ID)).toBe(false);
		expect(canDelete(mine({ conversationId: "uuid-other" }), DIRECT_ID)).toBe(false);
	});
});

describe("editFor / deleteFor", () => {
	test("an edit names the message and carries the new body", () => {
		expect(editFor(mine(), DIRECT_ID, "  hello, fixed  ")).toEqual({
			target: { sentAt: 1_000, authorId: SELF_AUTHOR_ID },
			body: "hello, fixed",
		});
	});

	test("an unchanged body is not an edit", () => {
		// Pressing enter without typing must not rewrite the row: that would mark it edited for
		// a change nobody made.
		expect(editFor(mine(), DIRECT_ID, "hello")).toBeNull();
		expect(editFor(mine(), DIRECT_ID, "   ")).toBeNull();
	});

	test("a delete names the message and nothing else", () => {
		expect(deleteFor(mine(), DIRECT_ID)).toEqual({ sentAt: 1_000, authorId: SELF_AUTHOR_ID });
		expect(deleteFor(theirs(), DIRECT_ID)).toBeNull();
	});
});

describe("createSession edits and deletes", () => {
	const open = async () => {
		const store = new InMemoryStore({ seed: false });
		await store.upsertConversation({
			id: DIRECT_ID,
			name: "Alice",
			unreadCount: 0,
			lastActivityAt: 1_000,
		});
		await store.saveMessage(mine());
		const backend = new FakeBackend();
		return { store, backend, session: createSession({ store, backend }) };
	};

	test("an edit reaches the backend and rewrites the cached row", async () => {
		const { store, backend, session } = await open();

		await session.edit(DIRECT_ID, { sentAt: 1_000, authorId: SELF_AUTHOR_ID }, "hello, fixed");

		expect(backend.edits).toEqual([
			{
				conversationId: DIRECT_ID,
				target: { sentAt: 1_000, authorId: SELF_AUTHOR_ID },
				body: "hello, fixed",
			},
		]);
		const [stored] = await store.listMessages(DIRECT_ID);
		expect(stored?.body).toBe("hello, fixed");
		expect(stored?.isEdited).toBe(true);
	});

	test("an edit the cache cannot place is still sent, and changes nothing locally", async () => {
		// The other side has the message; this cache does not (it expired here while the edit
		// was in flight). Sending is still correct — the correction is theirs to receive.
		const { store, backend, session } = await open();

		await session.edit(DIRECT_ID, { sentAt: 999_999, authorId: SELF_AUTHOR_ID }, "gone");

		expect(backend.edits).toHaveLength(1);
		const [stored] = await store.listMessages(DIRECT_ID);
		expect(stored?.body).toBe("hello");
		expect(stored?.isEdited).toBe(false);
	});

	test("a delete for everyone blanks the cached row", async () => {
		const { store, backend, session } = await open();

		await session.remove(DIRECT_ID, { sentAt: 1_000, authorId: SELF_AUTHOR_ID });

		expect(backend.deletions).toEqual([
			{ conversationId: DIRECT_ID, target: { sentAt: 1_000, authorId: SELF_AUTHOR_ID } },
		]);
		const [stored] = await store.listMessages(DIRECT_ID);
		expect(stored?.isDeleted).toBe(true);
		expect(stored?.body).toBe("");
	});

	test("hiding is local: the row survives, the reads skip it, nothing is sent", async () => {
		const { store, backend, session } = await open();

		await session.hide(DIRECT_ID, `${DIRECT_ID}:1000`);

		expect(await store.listMessages(DIRECT_ID)).toEqual([]);
		expect(await store.listAllMessages(DIRECT_ID)).toEqual([]);
		expect(backend.deletions).toEqual([]);
		expect(backend.edits).toEqual([]);
	});

	test("a refused send rejects to the caller, which is what shows the notice", async () => {
		// The send path deliberately does not swallow: the wiring turns the rejection into a
		// notice, and a store failure stays in `session.errors` because the queue owns it.
		const { backend, session } = await open();
		backend.failEdits = true;

		const error = await session
			.edit(DIRECT_ID, { sentAt: 1_000, authorId: SELF_AUTHOR_ID }, "nope")
			.then(
				() => null,
				(caught: Error) => caught,
			);

		expect(error?.message).toContain("edit rejected");
	});

	test("the demo store hides nothing twice", async () => {
		const { store, session } = await open();
		await session.hide(DIRECT_ID, `${DIRECT_ID}:1000`);
		// The second call is a no-op: the store reports no change, so nothing redraws.
		expect(await store.hideMessage(DIRECT_ID, `${DIRECT_ID}:1000`)).toBe(false);
		expect(message().id).toBe("m1");
	});
});
