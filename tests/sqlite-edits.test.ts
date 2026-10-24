import { afterEach, describe, expect, test } from "bun:test";
import { SqliteMessageStore } from "../src/adapters/sqlite/store";
import type { Conversation, Message } from "../src/domain/types";

const conversation = (overrides: Partial<Conversation> = {}): Conversation => ({
	id: "uuid-alice",
	name: "Alice",
	unreadCount: 0,
	lastActivityAt: 1_000,
	...overrides,
});

const message = (overrides: Partial<Message> = {}): Message => ({
	id: "m1",
	conversationId: "uuid-alice",
	author: "Alice",
	authorId: "uuid-alice",
	body: "hello",
	sentAt: 1_000,
	isOutgoing: false,
	isDeleted: false,
	...overrides,
});

const opened: SqliteMessageStore[] = [];
const open = (): SqliteMessageStore => {
	const store = new SqliteMessageStore({ path: ":memory:" });
	opened.push(store);
	return store;
};

afterEach(() => {
	for (const store of opened.splice(0)) {
		store.close();
	}
});

/** Edits touch one row, but they also have to leave search and replays consistent. */
describe("SqliteMessageStore edits", () => {
	test("applies an edit to a cached message", async () => {
		const store = open();
		await store.upsertConversation(conversation());
		await store.saveMessage(message({ body: "typo here" }));

		expect(
			await store.applyEdit(
				"uuid-alice",
				1_000,
				{ id: "uuid-alice", label: "Alice" },
				"typo fixed",
			),
		).toBe(true);

		const [saved] = await store.listMessages("uuid-alice");
		expect(saved?.body).toBe("typo fixed");
		expect(saved?.isEdited).toBe(true);
	});

	test("the edited text is searchable and the old text is not", async () => {
		const store = open();
		await store.upsertConversation(conversation());
		await store.saveMessage(message({ body: "meeting at noon" }));

		await store.applyEdit(
			"uuid-alice",
			1_000,
			{ id: "uuid-alice", label: "Alice" },
			"meeting at three",
		);

		expect(await store.search("three")).toHaveLength(1);
		expect(await store.search("noon")).toHaveLength(0);
	});

	test("an edit from another author does not land", async () => {
		const store = open();
		await store.upsertConversation(conversation());
		await store.saveMessage(message({ body: "Alice wrote this" }));

		// Same conversation, same timestamp, different author: inside a group the
		// timestamp alone does not identify whose message it is.
		const applied = await store.applyEdit(
			"uuid-alice",
			1_000,
			{ id: "uuid-bob", label: "Bob" },
			"Bob wrote this",
		);

		expect(applied).toBe(false);
		const [saved] = await store.listMessages("uuid-alice");
		expect(saved?.body).toBe("Alice wrote this");
		expect(saved?.isEdited).toBe(false);
	});

	test("a row cached before schema v4 is matched on its label", async () => {
		const store = open();
		await store.upsertConversation(conversation());
		// No authorId: this is what every row written by an older build looks like.
		await store.saveMessage({
			id: "m1",
			conversationId: "uuid-alice",
			author: "Alice",
			body: "older row",
			sentAt: 1_000,
			isOutgoing: false,
			isDeleted: false,
		});

		expect(await store.applyEdit("uuid-alice", 1_000, { id: null, label: "Alice" }, "fixed")).toBe(
			true,
		);
		expect(await store.applyEdit("uuid-alice", 1_000, { id: null, label: "Bob" }, "hijacked")).toBe(
			false,
		);
	});

	test("an edit for a message it does not have is a no-op", async () => {
		const store = open();
		await store.upsertConversation(conversation());

		expect(
			await store.applyEdit("uuid-alice", 999, { id: "uuid-alice", label: "Alice" }, "whatever"),
		).toBe(false);
	});

	test("a redelivered original does not undo an edit", async () => {
		const store = open();
		await store.upsertConversation(conversation());
		await store.saveMessage(message({ body: "original" }));
		await store.applyEdit("uuid-alice", 1_000, { id: "uuid-alice", label: "Alice" }, "corrected");

		// A reconnect replays the envelope that carried the original body.
		expect(await store.saveMessage(message({ body: "original" }))).toEqual({ inserted: false });

		const [saved] = await store.listMessages("uuid-alice");
		expect(saved?.body).toBe("corrected");
		expect(saved?.isEdited).toBe(true);
	});

	test("a replay does not resurrect a deleted message", async () => {
		const store = open();
		await store.upsertConversation(conversation());
		const original = message({
			id: "uuid-alice:1000",
			body: "say that again",
			attachments: [
				{
					id: "a1",
					contentType: "image/png",
					filename: "x.png",
					size: 1,
					caption: null,
					isVoiceNote: false,
				},
			],
		});
		await store.saveMessage(original);
		await store.markMessageDeleted("uuid-alice", "uuid-alice:1000");

		// Signal has no undelete: a redelivered envelope must not revive the row, its
		// text or its files.
		await store.saveMessage(original);

		const [saved] = await store.listMessages("uuid-alice");
		expect(saved?.isDeleted).toBe(true);
		expect(saved?.body).toBe("");
		expect(saved?.attachments).toEqual([]);
	});

	test("does not resurrect a deleted message", async () => {
		const store = open();
		await store.upsertConversation(conversation());
		await store.saveMessage(message({ body: "gone" }));
		await store.markMessageDeleted("uuid-alice", "m1");

		expect(
			await store.applyEdit(
				"uuid-alice",
				1_000,
				{ id: "uuid-alice", label: "Alice" },
				"back again",
			),
		).toBe(false);
		expect((await store.listMessages("uuid-alice"))[0]?.body).toBe("");
	});
});
