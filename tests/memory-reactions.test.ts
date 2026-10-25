import { describe, expect, test } from "bun:test";
import { InMemoryStore } from "../src/adapters/memory/store";
import type { Conversation, Message, Reaction } from "../src/domain/types";

/** The same rules as the SQLite adapter: demo mode must not behave differently. */
const conversation: Conversation = {
	id: "uuid-carol",
	name: "Carol",
	unreadCount: 0,
	lastActivityAt: 1_000,
};

const message = (overrides: Partial<Message> = {}): Message => ({
	id: "uuid-carol:1000",
	conversationId: "uuid-carol",
	author: "You",
	authorId: "self",
	body: "hello there",
	sentAt: 1_000,
	isOutgoing: true,
	isDeleted: false,
	...overrides,
});

const reaction = (overrides: Partial<Reaction> = {}): Reaction => ({
	emoji: "👍",
	author: "Carol",
	authorId: "uuid-carol",
	...overrides,
});

const only = async (store: InMemoryStore): Promise<Message | undefined> =>
	(await store.listAllMessages("uuid-carol"))[0];

const seed = async (store: InMemoryStore, overrides: Partial<Message> = {}): Promise<void> => {
	await store.upsertConversation(conversation);
	await store.saveMessage(message(overrides));
};

describe("InMemoryStore reactions", () => {
	test("adds a reaction to a cached message", async () => {
		const store = new InMemoryStore();
		await seed(store);

		expect(await store.applyReaction("uuid-carol", 1_000, reaction(), false)).toBe(true);
		expect((await only(store))?.reactions).toEqual([
			{ emoji: "👍", author: "Carol", authorId: "uuid-carol" },
		]);
	});

	test("a second emoji from the same person replaces the first", async () => {
		const store = new InMemoryStore();
		await seed(store);

		await store.applyReaction("uuid-carol", 1_000, reaction(), false);
		await store.applyReaction("uuid-carol", 1_000, reaction({ emoji: "❤️" }), false);

		expect((await only(store))?.reactions).toEqual([
			{ emoji: "❤️", author: "Carol", authorId: "uuid-carol" },
		]);
	});

	test("repeating the same reaction reports no change", async () => {
		const store = new InMemoryStore();
		await seed(store);
		await store.applyReaction("uuid-carol", 1_000, reaction(), false);

		expect(await store.applyReaction("uuid-carol", 1_000, reaction(), false)).toBe(false);
	});

	test("a removal takes the reaction away, and a second removal changes nothing", async () => {
		const store = new InMemoryStore();
		await seed(store);
		await store.applyReaction("uuid-carol", 1_000, reaction(), false);

		expect(await store.applyReaction("uuid-carol", 1_000, reaction(), true)).toBe(true);
		expect((await only(store))?.reactions).toBeUndefined();
		expect(await store.applyReaction("uuid-carol", 1_000, reaction(), true)).toBe(false);
	});

	test("a reaction to a message the store does not have is not an error", async () => {
		const store = new InMemoryStore();
		await store.upsertConversation(conversation);

		expect(await store.applyReaction("uuid-carol", 9_999, reaction(), false)).toBe(false);
		expect(await store.listAllMessages("uuid-carol")).toEqual([]);
	});

	test("a deleted message drops its reactions and takes no new ones", async () => {
		const store = new InMemoryStore();
		await seed(store);
		await store.applyReaction("uuid-carol", 1_000, reaction(), false);

		await store.markMessageDeleted("uuid-carol", "uuid-carol:1000");

		expect((await only(store))?.reactions).toBeUndefined();
		expect(await store.applyReaction("uuid-carol", 1_000, reaction(), false)).toBe(false);
	});

	test("a swept message drops the reactions it carried", async () => {
		const store = new InMemoryStore();
		await seed(store, { expiresAt: 3_000 });
		await store.applyReaction("uuid-carol", 1_000, reaction(), false);

		await store.purgeExpired(5_000);

		const swept = await only(store);
		expect(swept?.isExpired).toBe(true);
		expect(swept?.reactions).toBeUndefined();
	});
});
