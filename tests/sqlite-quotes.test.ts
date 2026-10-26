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
	id: "uuid-alice:1000",
	conversationId: "uuid-alice",
	author: "Alice",
	authorId: "uuid-alice",
	body: "second message",
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

const byId = async (store: SqliteMessageStore, id: string): Promise<Message | undefined> =>
	(await store.listAllMessages("uuid-alice")).find((entry) => entry.id === id);

describe("SqliteMessageStore quotes", () => {
	test("stores the identity of the quoted message", async () => {
		const store = open();
		await store.upsertConversation(conversation());
		await store.saveMessage(message({ quote: { sentAt: 500, authorId: "uuid-alice" } }));

		const stored = await byId(store, "uuid-alice:1000");
		expect(stored?.quote).toEqual({ sentAt: 500, authorId: "uuid-alice" });
	});

	test("a payload that carries no quote says nothing about the stored one", async () => {
		const store = open();
		await store.upsertConversation(conversation());
		await store.saveMessage(message({ quote: { sentAt: 500, authorId: "uuid-alice" } }));

		// Same message redelivered from a path that knows nothing about replies: without
		// COALESCE the quote would be erased and the reply would stop naming its target.
		await store.saveMessage(message());

		expect((await byId(store, "uuid-alice:1000"))?.quote).toEqual({
			sentAt: 500,
			authorId: "uuid-alice",
		});
	});

	test("a message that is not a reply has no quote", async () => {
		const store = open();
		await store.upsertConversation(conversation());
		await store.saveMessage(message());

		expect((await byId(store, "uuid-alice:1000"))?.quote).toBeUndefined();
	});

	test("a view-once message keeps the marker, which holds no words", async () => {
		// The marker names another message; it is not this message's content, so a
		// view-once request does not have to take it away.
		const store = open();
		await store.upsertConversation(conversation());
		await store.saveMessage(
			message({ isViewOnce: true, body: "look", quote: { sentAt: 500, authorId: null } }),
		);

		const stored = await byId(store, "uuid-alice:1000");
		expect(stored?.body).toBe("");
		expect(stored?.quote).toEqual({ sentAt: 500, authorId: null });
	});
});
