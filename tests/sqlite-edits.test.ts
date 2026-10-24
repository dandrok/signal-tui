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

		expect(await store.applyEdit("uuid-alice", 1_000, "typo fixed")).toBe(true);

		const [saved] = await store.listMessages("uuid-alice");
		expect(saved?.body).toBe("typo fixed");
		expect(saved?.isEdited).toBe(true);
	});

	test("the edited text is searchable and the old text is not", async () => {
		const store = open();
		await store.upsertConversation(conversation());
		await store.saveMessage(message({ body: "meeting at noon" }));

		await store.applyEdit("uuid-alice", 1_000, "meeting at three");

		expect(await store.search("three")).toHaveLength(1);
		expect(await store.search("noon")).toHaveLength(0);
	});

	test("an edit for a message it does not have is a no-op", async () => {
		const store = open();
		await store.upsertConversation(conversation());

		expect(await store.applyEdit("uuid-alice", 999, "whatever")).toBe(false);
	});

	test("a redelivered original does not undo an edit", async () => {
		const store = open();
		await store.upsertConversation(conversation());
		await store.saveMessage(message({ body: "original" }));
		await store.applyEdit("uuid-alice", 1_000, "corrected");

		// A reconnect replays the envelope that carried the original body.
		expect(await store.saveMessage(message({ body: "original" }))).toEqual({ inserted: false });

		const [saved] = await store.listMessages("uuid-alice");
		expect(saved?.body).toBe("corrected");
		expect(saved?.isEdited).toBe(true);
	});

	test("does not resurrect a deleted message", async () => {
		const store = open();
		await store.upsertConversation(conversation());
		await store.saveMessage(message({ body: "gone" }));
		await store.markMessageDeleted("uuid-alice", "m1");

		expect(await store.applyEdit("uuid-alice", 1_000, "back again")).toBe(false);
		expect((await store.listMessages("uuid-alice"))[0]?.body).toBe("");
	});
});
