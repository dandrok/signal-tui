import { afterEach, describe, expect, test } from "bun:test";
import {
	chmodSync,
	existsSync,
	mkdtempSync,
	readdirSync,
	readlinkSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
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

/** Number of open file descriptors pointing at `needle`, to prove handles are released. */
const openHandlesFor = (needle: string): number =>
	readdirSync("/proc/self/fd").filter((fd) => {
		try {
			return readlinkSync(`/proc/self/fd/${fd}`).includes(needle);
		} catch {
			return false;
		}
	}).length;

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

	test("preserves the later activity time", async () => {
		const store = open();
		await store.upsertConversation(conversation({ lastActivityAt: 5_000 }));

		// A late-arriving transcript carries an older timestamp.
		await store.upsertConversation(conversation({ lastActivityAt: 1_000 }));

		expect((await store.listConversations())[0]?.lastActivityAt).toBe(5_000);
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

	test("counts unread messages and clears them when read", async () => {
		const store = open();
		await store.upsertConversation(conversation());

		await store.incrementUnread("uuid-alice", 1);
		await store.incrementUnread("uuid-alice", 1);
		expect((await store.listConversations())[0]?.unreadCount).toBe(2);

		await store.markConversationRead("uuid-alice");
		expect((await store.listConversations())[0]?.unreadCount).toBe(0);
	});

	test("leaves the unread count alone when metadata is updated", async () => {
		const store = open();
		await store.upsertConversation(conversation());
		await store.incrementUnread("uuid-alice", 3);

		// An outgoing transcript carries a fresh name and activity, but unread 0.
		await store.upsertConversation(conversation({ name: "Alice Smith", lastActivityAt: 9_000 }));

		const [stored] = await store.listConversations();
		expect(stored?.unreadCount).toBe(3);
		expect(stored?.name).toBe("Alice Smith");
	});

	test("incrementing an unknown conversation is a no-op", async () => {
		const store = open();
		await store.incrementUnread("nobody", 1);
		expect(await store.listConversations()).toEqual([]);
	});

	test("treats a whitespace-only name as unknown", async () => {
		const store = open();
		await store.upsertConversation(conversation({ name: "Alice" }));

		await store.upsertConversation(conversation({ name: "   " }));

		expect((await store.listConversations())[0]?.name).toBe("Alice");
	});

	test("keeps a known name when a sync transcript has none", async () => {
		const store = open();
		await store.upsertConversation(conversation({ name: "Alice" }));

		// A sent message only knows the destination id.
		await store.upsertConversation(conversation({ name: "", lastActivityAt: 2_000 }));

		const [updated] = await store.listConversations();
		expect(updated?.name).toBe("Alice");
		expect(updated?.lastActivityAt).toBe(2_000);
	});

	test("rejects a message whose conversation does not exist", async () => {
		const store = open();
		await expect(store.saveMessage(message({ conversationId: "ghost" }))).rejects.toThrow();
	});

	test("marks a message deleted and clears its body", async () => {
		const store = open();
		await store.upsertConversation(conversation());
		await store.saveMessage(message({ body: "oops" }));

		await store.markMessageDeleted("uuid-alice", "m1");

		const [saved] = await store.listMessages("uuid-alice");
		expect(saved?.isDeleted).toBe(true);
		expect(saved?.body).toBe("");
		expect(await store.search("oops")).toEqual([]);
	});

	test("ignores a delete for a message it does not have", async () => {
		const store = open();
		await store.upsertConversation(conversation());

		await store.markMessageDeleted("uuid-alice", "missing");

		expect(await store.listMessages("uuid-alice")).toEqual([]);
	});

	test("started at schema version 1", async () => {
		expect(open().schemaVersion).toBe(1);
	});

	test.skipIf(process.platform !== "linux")(
		"keeps the cache private even if it already existed",
		async () => {
			const dir = mkdtempSync(join(tmpdir(), "signal-tui-perm-"));
			const path = join(dir, "cache.db");
			// Pre-create it world-readable: with a typical umask SQLite would create
			// 0600 on its own, so the test must not depend on that.
			writeFileSync(path, "");
			(chmodSync as (file: string, mode: number) => void)(path, 0o644);

			opened.push(new SqliteMessageStore({ path }));

			// 0600: bodies are plaintext, so other local users must not read them.
			expect(statSync(path).mode & 0o777).toBe(0o600);
		},
	);

	test.skipIf(!existsSync("/proc/self/fd"))("closes the handle when initialization fails", () => {
		const dir = mkdtempSync(join(tmpdir(), "signal-tui-bad-"));
		const path = join(dir, "corrupt.db");
		writeFileSync(path, "this is not a sqlite database".repeat(32));

		try {
			expect(() => new SqliteMessageStore({ path })).toThrow();
			// Construction threw, so nobody else can close the handle: it must be gone.
			expect(openHandlesFor("corrupt.db")).toBe(0);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
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
