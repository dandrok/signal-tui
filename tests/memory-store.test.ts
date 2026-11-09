import { describe, expect, test } from "bun:test";
import { InMemoryStore } from "../src/adapters/memory/store";

const conversation = (overrides: Record<string, unknown> = {}) => ({
	id: "uuid-x",
	name: "Alice",
	unreadCount: 0,
	lastActivityAt: 1_000,
	...overrides,
});

describe("InMemoryStore", () => {
	test("does not return a deleted message that still has its text", async () => {
		const store = new InMemoryStore();
		// A deleted row that keeps its body: the only way the filter is load-bearing.
		await store.saveMessage({
			id: "deleted-hit",
			conversationId: "signal-devs",
			author: "Alice",
			body: "purple elephants",
			sentAt: 1,
			isOutgoing: false,
			isDeleted: true,
		});

		expect(await store.search("purple")).toEqual([]);
	});

	test("applies an edit to a cached message and marks it edited", async () => {
		const store = new InMemoryStore();
		await store.upsertConversation(conversation());
		await store.saveMessage({
			id: "m1",
			conversationId: "uuid-x",
			author: "Alice",
			authorId: "uuid-alice",
			body: "typo here",
			sentAt: 1_000,
			isOutgoing: false,
			isDeleted: false,
		});

		expect(
			await store.applyEdit("uuid-x", 1_000, { id: "uuid-alice", label: "Alice" }, "typo fixed"),
		).toBe(true);

		const [saved] = await store.listMessages("uuid-x");
		expect(saved?.body).toBe("typo fixed");
		expect(saved?.isEdited).toBe(true);
		expect(await store.search("fixed")).toHaveLength(1);
		expect(await store.search("here")).toHaveLength(0);
	});

	test("a redelivered original does not undo an edit", async () => {
		const store = new InMemoryStore();
		await store.upsertConversation(conversation());
		const original = {
			id: "m1",
			conversationId: "uuid-x",
			author: "Alice",
			authorId: "uuid-alice",
			body: "original",
			sentAt: 1_000,
			isOutgoing: false,
			isDeleted: false,
		};
		await store.saveMessage(original);
		await store.applyEdit("uuid-x", 1_000, { id: "uuid-alice", label: "Alice" }, "corrected");

		// A reconnect replays the envelope that carried the original body.
		expect(await store.saveMessage(original)).toEqual({ inserted: false });

		const [saved] = await store.listMessages("uuid-x");
		expect(saved?.body).toBe("corrected");
		expect(saved?.isEdited).toBe(true);
	});

	test("a replay does not resurrect a deleted message", async () => {
		const store = new InMemoryStore();
		await store.upsertConversation(conversation());
		const original = {
			id: "m1",
			conversationId: "uuid-x",
			author: "Alice",
			authorId: "uuid-alice",
			body: "say that again",
			sentAt: 1_000,
			isOutgoing: false,
			isDeleted: false,
			attachments: [
				{
					id: "a1",
					filename: "x.png",
					contentType: "image/png",
					size: 1,
					caption: null,
					isVoiceNote: false,
				},
			],
		};
		await store.saveMessage(original);
		await store.markMessageDeleted("uuid-x", "m1", { id: "uuid-alice", label: "Alice" });

		// Signal has no undelete, so the redelivered envelope changes nothing.
		await store.saveMessage(original);

		const [saved] = await store.listMessages("uuid-x");
		expect(saved?.isDeleted).toBe(true);
		expect(saved?.body).toBe("");
		expect(saved?.attachments).toEqual([]);
	});

	test("a second delete of the same message reports no change", async () => {
		const store = new InMemoryStore();
		await store.upsertConversation(conversation());
		await store.saveMessage({
			id: "m1",
			conversationId: "uuid-x",
			author: "Alice",
			authorId: "uuid-alice",
			body: "oops",
			sentAt: 1_000,
			isOutgoing: false,
			isDeleted: false,
		});
		const deleter = { id: "uuid-alice", label: "Alice" };

		expect(await store.markMessageDeleted("uuid-x", "m1", deleter)).toBe(true);
		// A reconnect replays the delete envelope; the pane must not reload for it.
		expect(await store.markMessageDeleted("uuid-x", "m1", deleter)).toBe(false);
	});

	test("a peer cannot delete a row that kept no author id, and we can", async () => {
		const store = new InMemoryStore();
		await store.upsertConversation(conversation());
		// A row cached before schema v4: no author id, only a label any peer can copy.
		await store.saveMessage({
			id: "m1",
			conversationId: "uuid-x",
			author: "Alice",
			body: "older row",
			sentAt: 1_000,
			isOutgoing: false,
			isDeleted: false,
		});
		// Our own message from the same era: outgoing, which no peer can produce.
		await store.saveMessage({
			id: "m2",
			conversationId: "uuid-x",
			author: "You",
			body: "sent long ago",
			sentAt: 2_000,
			isOutgoing: true,
			isDeleted: false,
		});

		expect(
			await store.markMessageDeleted("uuid-x", "m1", { id: "uuid-mallory", label: "Alice" }),
		).toBe(false);
		const [untouched] = await store.listMessages("uuid-x");
		expect(untouched?.body).toBe("older row");

		expect(await store.markMessageDeleted("uuid-x", "m2", { id: "self", label: "You" })).toBe(true);
	});

	test("a payload that shares the id but not the author writes nothing", async () => {
		const store = new InMemoryStore();
		await store.upsertConversation(conversation());
		const mine = {
			id: "m1",
			conversationId: "uuid-x",
			author: "Alice",
			authorId: "uuid-alice",
			body: "Alice wrote this",
			sentAt: 1_000,
			isOutgoing: false,
			isDeleted: false,
		};
		await store.saveMessage(mine);

		expect(
			await store.saveMessage({
				...mine,
				author: "Eve",
				authorId: "uuid-eve",
				body: "and now Eve",
			}),
		).toEqual({ inserted: false });

		const [row] = await store.listMessages("uuid-x");
		expect(row?.author).toBe("Alice");
		expect(row?.authorId).toBe("uuid-alice");
		expect(row?.body).toBe("Alice wrote this");
	});

	test("an edit from another author does not land", async () => {
		const store = new InMemoryStore();
		await store.upsertConversation(conversation());
		await store.saveMessage({
			id: "m1",
			conversationId: "uuid-x",
			author: "Alice",
			authorId: "uuid-alice",
			body: "Alice wrote this",
			sentAt: 1_000,
			isOutgoing: false,
			isDeleted: false,
		});

		expect(await store.applyEdit("uuid-x", 1_000, { id: "uuid-bob", label: "Bob" }, "nope")).toBe(
			false,
		);
		const [saved] = await store.listMessages("uuid-x");
		expect(saved?.body).toBe("Alice wrote this");
	});

	test("a replay without an author id keeps the stored one", async () => {
		const store = new InMemoryStore();
		await store.upsertConversation(conversation());
		const withId = {
			id: "m1",
			conversationId: "uuid-x",
			author: "Alice",
			authorId: "uuid-alice",
			body: "hello",
			sentAt: 1_000,
			isOutgoing: false,
			isDeleted: false,
		};
		await store.saveMessage(withId);

		// A partial update says nothing about the sender; it must not clear the id and
		// drop the row back to label matching.
		const { authorId: _dropped, ...withoutId } = withId;
		await store.saveMessage(withoutId);

		expect((await store.listMessages("uuid-x"))[0]?.authorId).toBe("uuid-alice");
		// a different author who happens to share the label is still refused
		expect(await store.applyEdit("uuid-x", 1_000, { id: "uuid-bob", label: "Alice" }, "x")).toBe(
			false,
		);
	});

	test("a row without an author id is not matched on its label", async () => {
		const store = new InMemoryStore();
		await store.upsertConversation(conversation());
		await store.saveMessage({
			id: "m1",
			conversationId: "uuid-x",
			author: "Alice",
			body: "older row",
			sentAt: 1_000,
			isOutgoing: false,
			isDeleted: false,
		});

		// A display label is whatever the sender set it to, so naming yourself "Alice" must not
		// reach a row that kept no id — and an id-less payload establishes nothing either.
		expect(
			await store.applyEdit("uuid-x", 1_000, { id: "uuid-mallory", label: "Alice" }, "x"),
		).toBe(false);
		expect(await store.applyEdit("uuid-x", 1_000, { id: null, label: "Alice" }, "x")).toBe(false);
		expect((await store.listMessages("uuid-x"))[0]?.body).toBe("older row");

		// The only identity such a row still has is ours: an outgoing message, edited by this app.
		await store.saveMessage({
			id: "m2",
			conversationId: "uuid-x",
			author: "You",
			body: "sent long ago",
			sentAt: 2_000,
			isOutgoing: true,
			isDeleted: false,
		});
		expect(await store.applyEdit("uuid-x", 2_000, { id: "self", label: "You" }, "fixed")).toBe(
			true,
		);
	});

	test("an edit for an unknown or deleted message changes nothing", async () => {
		const store = new InMemoryStore();
		await store.upsertConversation(conversation());
		await store.saveMessage({
			id: "m1",
			conversationId: "uuid-x",
			author: "Alice",
			body: "gone",
			sentAt: 1_000,
			isOutgoing: false,
			isDeleted: true,
		});

		expect(await store.applyEdit("uuid-x", 999, { id: "uuid-alice", label: "Alice" }, "nope")).toBe(
			false,
		);
		expect(
			await store.applyEdit("uuid-x", 1_000, { id: "uuid-alice", label: "Alice" }, "back"),
		).toBe(false);
		expect((await store.listMessages("uuid-x"))[0]?.body).toBe("gone");
	});

	test("keeps the name, unread count and activity monotonic", async () => {
		const store = new InMemoryStore();
		await store.upsertConversation(conversation({ lastActivityAt: 5_000 }));
		await store.incrementUnread("uuid-x", 2);

		// An outgoing transcript knows no name, reports unread 0, and may arrive late.
		await store.upsertConversation(
			conversation({ name: "", unreadCount: 0, lastActivityAt: 1_000 }),
		);

		const [stored] = (await store.listConversations()).filter((entry) => entry.id === "uuid-x");
		expect(stored?.name).toBe("Alice");
		expect(stored?.unreadCount).toBe(2);
		expect(stored?.lastActivityAt).toBe(5_000);
	});
});
