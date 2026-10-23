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
	test("does not return deleted messages from search", async () => {
		const store = new InMemoryStore();
		await store.markMessageDeleted("signal-devs", "seed-1");

		const hits = await store.search("seed");

		expect(hits.every((entry) => !entry.isDeleted)).toBe(true);
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
