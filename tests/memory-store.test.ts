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
			body: "typo here",
			sentAt: 1_000,
			isOutgoing: false,
			isDeleted: false,
		});

		expect(await store.applyEdit("uuid-x", 1_000, "typo fixed")).toBe(true);

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
			body: "original",
			sentAt: 1_000,
			isOutgoing: false,
			isDeleted: false,
		};
		await store.saveMessage(original);
		await store.applyEdit("uuid-x", 1_000, "corrected");

		// A reconnect replays the envelope that carried the original body.
		expect(await store.saveMessage(original)).toEqual({ inserted: false });

		const [saved] = await store.listMessages("uuid-x");
		expect(saved?.body).toBe("corrected");
		expect(saved?.isEdited).toBe(true);
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

		expect(await store.applyEdit("uuid-x", 999, "nope")).toBe(false);
		expect(await store.applyEdit("uuid-x", 1_000, "back")).toBe(false);
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
