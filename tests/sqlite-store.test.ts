import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
const open = (path = ":memory:"): SqliteMessageStore => {
	const store = new SqliteMessageStore({ path });
	opened.push(store);
	return store;
};

afterEach(() => {
	for (const store of opened.splice(0)) {
		try {
			store.close();
		} catch {
			// already closed by the persistence test
		}
	}
});

describe("SqliteMessageStore", () => {
	test("round-trips a message", async () => {
		const store = open();
		await store.upsertConversation(conversation());

		await store.saveMessage(message({ body: "pushed the fix", isOutgoing: true, isDeleted: true }));

		const [saved] = await store.listMessages("uuid-alice");
		expect(saved).toEqual({
			id: "m1",
			conversationId: "uuid-alice",
			author: "Alice",
			body: "pushed the fix",
			sentAt: 1_000,
			isOutgoing: true,
			isDeleted: true,
		});
	});

	test("replaying the same message updates it instead of duplicating", async () => {
		const store = open();
		await store.upsertConversation(conversation());

		await store.saveMessage(message({ body: "typo here" }));
		await store.saveMessage(message({ body: "typo fixed" }));

		const saved = await store.listMessages("uuid-alice");
		expect(saved).toHaveLength(1);
		expect(saved[0]?.body).toBe("typo fixed");
	});

	test("returns the newest messages in reading order", async () => {
		const store = open();
		await store.upsertConversation(conversation());
		for (const sentAt of [1, 2, 3, 4, 5]) {
			await store.saveMessage(message({ id: `m${sentAt}`, sentAt, body: `msg ${sentAt}` }));
		}

		const page = await store.listMessages("uuid-alice", 2);

		expect(page.map((entry) => entry.id)).toEqual(["m4", "m5"]);
	});

	test("returns nothing for an unknown conversation or a zero limit", async () => {
		const store = open();
		await store.upsertConversation(conversation());
		await store.saveMessage(message());

		expect(await store.listMessages("nobody")).toEqual([]);
		expect(await store.listMessages("uuid-alice", 0)).toEqual([]);
	});

	test("orders conversations by last activity", async () => {
		const store = open();
		await store.upsertConversation(conversation({ id: "a", name: "Old", lastActivityAt: 10 }));
		await store.upsertConversation(conversation({ id: "b", name: "New", lastActivityAt: 20 }));

		expect((await store.listConversations()).map((entry) => entry.id)).toEqual(["b", "a"]);
	});

	test("refreshes the name and never moves activity backwards", async () => {
		const store = open();
		await store.upsertConversation(conversation({ name: "Alice", lastActivityAt: 5_000 }));

		await store.upsertConversation(conversation({ name: "Alice Smith", lastActivityAt: 1_000 }));

		const [updated] = await store.listConversations();
		expect(updated?.name).toBe("Alice Smith");
		expect(updated?.lastActivityAt).toBe(5_000);
	});

	test("rejects a message whose conversation does not exist", async () => {
		const store = open();
		await expect(store.saveMessage(message({ conversationId: "ghost" }))).rejects.toThrow();
	});

	test("started at schema version 1", async () => {
		expect(open().schemaVersion).toBe(1);
	});

	test("survives a reopen", async () => {
		const dir = mkdtempSync(join(tmpdir(), "signal-tui-"));
		const path = join(dir, "cache.db");

		const first = new SqliteMessageStore({ path });
		await first.upsertConversation(conversation());
		await first.saveMessage(message({ body: "durable" }));
		first.close();

		const second = new SqliteMessageStore({ path });
		try {
			const [saved] = await second.listMessages("uuid-alice");
			expect(saved?.body).toBe("durable");
		} finally {
			second.close();
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
