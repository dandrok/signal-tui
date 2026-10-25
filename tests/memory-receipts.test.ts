import { describe, expect, test } from "bun:test";
import { InMemoryStore } from "../src/adapters/memory/store";
import type { Conversation, Message } from "../src/domain/types";

/**
 * The same rules the SQLite adapter follows, because this store is what demo mode
 * and half the suite run against: a rule that lives in one adapter is a rule half
 * the app can break.
 */
const conversation = (overrides: Partial<Conversation> = {}): Conversation => ({
	id: "uuid-carol",
	name: "Carol",
	unreadCount: 0,
	lastActivityAt: 1_000,
	...overrides,
});

const message = (overrides: Partial<Message> = {}): Message => ({
	id: "uuid-carol:1000",
	conversationId: "uuid-carol",
	author: "Carol",
	authorId: "uuid-carol",
	body: "hi",
	sentAt: 1_000,
	isOutgoing: true,
	isDeleted: false,
	...overrides,
});

const byId = async (store: InMemoryStore, id: string) =>
	(await store.listAllMessages("uuid-carol")).find((entry) => entry.id === id);

describe("InMemoryStore receipts", () => {
	test("records a receipt for our own messages and leaves the other side's alone", async () => {
		const store = new InMemoryStore();
		await store.upsertConversation(conversation());
		await store.saveMessage(message({ id: "uuid-carol:1000", sentAt: 1_000, isOutgoing: true }));
		await store.saveMessage(message({ id: "uuid-carol:2000", sentAt: 2_000, isOutgoing: false }));

		const changed = await store.applyReceipt([1_000, 2_000], "read");

		expect(changed).toEqual(["uuid-carol"]);
		expect((await byId(store, "uuid-carol:1000"))?.receipt).toBe("read");
		expect((await byId(store, "uuid-carol:2000"))?.receipt).toBeUndefined();
	});

	test("never downgrades a receipt that already went further", async () => {
		const store = new InMemoryStore();
		await store.upsertConversation(conversation());
		await store.saveMessage(message());

		expect(await store.applyReceipt([1_000], "read")).toEqual(["uuid-carol"]);
		expect(await store.applyReceipt([1_000], "delivered")).toEqual([]);
		expect((await byId(store, "uuid-carol:1000"))?.receipt).toBe("read");
	});

	test("a replay without a receipt keeps the one that was stored", async () => {
		const store = new InMemoryStore();
		await store.upsertConversation(conversation());
		await store.saveMessage(message());
		await store.applyReceipt([1_000], "read");

		// A reconnect replays the original envelope, which never carries a receipt:
		// spreading it over the row would erase the ticks.
		await store.saveMessage(message({ body: "hi" }));

		expect((await byId(store, "uuid-carol:1000"))?.receipt).toBe("read");
	});
});
