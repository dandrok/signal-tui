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
	body: "hi",
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

const byId = async (store: SqliteMessageStore, conversationId: string, id: string) =>
	(await store.listMessages(conversationId)).find((entry) => entry.id === id);

describe("SqliteMessageStore receipts", () => {
	test("records a receipt for our own messages and leaves the other side's alone", async () => {
		const store = open();
		await store.upsertConversation(conversation());
		await store.saveMessage(message({ id: "uuid-alice:1000", sentAt: 1_000, isOutgoing: true }));
		// Positive control for the guard: same conversation, same receipt, but the peer
		// wrote it — a receipt may only ever acknowledge what we sent.
		await store.saveMessage(message({ id: "uuid-alice:2000", sentAt: 2_000, isOutgoing: false }));

		const changed = await store.applyReceipt([1_000, 2_000], "read");

		expect(changed).toEqual(["uuid-alice"]);
		expect((await byId(store, "uuid-alice", "uuid-alice:1000"))?.receipt).toBe("read");
		expect((await byId(store, "uuid-alice", "uuid-alice:2000"))?.receipt).toBeUndefined();
	});

	test("never downgrades a receipt that already went further", async () => {
		const store = open();
		await store.upsertConversation(conversation());
		await store.saveMessage(message({ id: "uuid-alice:1000", sentAt: 1_000, isOutgoing: true }));

		expect(await store.applyReceipt([1_000], "read")).toEqual(["uuid-alice"]);
		// A delivery arrives late, the way a device that was offline reports it.
		expect(await store.applyReceipt([1_000], "delivered")).toEqual([]);
		expect((await byId(store, "uuid-alice", "uuid-alice:1000"))?.receipt).toBe("read");
	});

	test("upgrades a delivery to a read", async () => {
		const store = open();
		await store.upsertConversation(conversation());
		await store.saveMessage(message({ id: "uuid-alice:1000", sentAt: 1_000, isOutgoing: true }));

		await store.applyReceipt([1_000], "delivered");
		await store.applyReceipt([1_000], "read");

		expect((await byId(store, "uuid-alice", "uuid-alice:1000"))?.receipt).toBe("read");
	});

	test("names each affected conversation once", async () => {
		const store = open();
		await store.upsertConversation(conversation());
		await store.upsertConversation(conversation({ id: "uuid-bob", name: "Bob" }));
		for (const sentAt of [1_000, 2_000]) {
			await store.saveMessage(message({ id: `uuid-alice:${sentAt}`, sentAt, isOutgoing: true }));
		}
		await store.saveMessage(
			message({
				id: "uuid-bob:3000",
				conversationId: "uuid-bob",
				authorId: "uuid-bob",
				sentAt: 3_000,
				isOutgoing: true,
			}),
		);

		const changed = await store.applyReceipt([1_000, 2_000, 3_000], "read");

		expect([...changed].sort()).toEqual(["uuid-alice", "uuid-bob"]);
	});

	test("a receipt for messages this cache never stored changes nothing", async () => {
		const store = open();
		await store.upsertConversation(conversation());

		expect(await store.applyReceipt([9_999], "read")).toEqual([]);
	});

	test("sweeps a receipt longer than one chunk without losing entries", async () => {
		const store = open();
		await store.upsertConversation(conversation());
		const ours = [1_000, 2_000, 3_000];
		for (const sentAt of ours) {
			await store.saveMessage(message({ id: `uuid-alice:${sentAt}`, sentAt, isOutgoing: true }));
		}
		// Filler timestamps nobody wrote, spread across three chunks so each of ours
		// lands in a different statement — first, middle and last.
		const filler = Array.from({ length: 1_200 }, (_, index) => 10_000 + index);
		const receipt = [...filler];
		receipt.splice(0, 0, ours[0] as number);
		receipt.splice(600, 0, ours[1] as number);
		receipt.push(ours[2] as number);

		await store.applyReceipt(receipt, "read");

		for (const sentAt of ours) {
			expect((await byId(store, "uuid-alice", `uuid-alice:${sentAt}`))?.receipt).toBe("read");
		}
	});
});
