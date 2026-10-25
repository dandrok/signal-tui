import { afterEach, describe, expect, test } from "bun:test";
import { SqliteMessageStore } from "../src/adapters/sqlite/store";
import type { Conversation, Message, Reaction } from "../src/domain/types";

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
	author: "Alice",
	authorId: "uuid-alice",
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

const only = async (store: SqliteMessageStore): Promise<Message | undefined> =>
	(await store.listAllMessages("uuid-alice"))[0];

const seed = async (store: SqliteMessageStore, overrides: Partial<Message> = {}): Promise<void> => {
	await store.upsertConversation(conversation());
	await store.saveMessage(message(overrides));
};

describe("SqliteMessageStore reactions", () => {
	test("adds a reaction to a cached message", async () => {
		const store = open();
		await seed(store);

		expect(await store.applyReaction("uuid-alice", 1_000, reaction(), false)).toBe(true);
		expect((await only(store))?.reactions).toEqual([
			{ emoji: "👍", author: "Alice", authorId: "uuid-alice" },
		]);
	});

	test("a second emoji from the same person replaces the first", async () => {
		const store = open();
		await seed(store);

		await store.applyReaction("uuid-alice", 1_000, reaction(), false);
		await store.applyReaction("uuid-alice", 1_000, reaction({ emoji: "❤️" }), false);

		// One reaction per person, not one per emoji.
		expect((await only(store))?.reactions).toEqual([
			{ emoji: "❤️", author: "Alice", authorId: "uuid-alice" },
		]);
	});

	test("repeating the same reaction reports no change", async () => {
		const store = open();
		await seed(store);
		await store.applyReaction("uuid-alice", 1_000, reaction(), false);

		// A reconnect replays the envelope; the UI must not redraw for the same marker.
		expect(await store.applyReaction("uuid-alice", 1_000, reaction(), false)).toBe(false);
	});

	test("two people reacting keep their own rows", async () => {
		const store = open();
		await seed(store);

		await store.applyReaction("uuid-alice", 1_000, reaction(), false);
		await store.applyReaction("uuid-alice", 1_000, reaction(), false);
		await store.applyReaction(
			"uuid-alice",
			1_000,
			reaction({ authorId: "uuid-bob", author: "Bob" }),
			false,
		);

		expect((await only(store))?.reactions).toHaveLength(2);
	});

	test("a removal takes the reaction away, and a second removal changes nothing", async () => {
		const store = open();
		await seed(store);
		await store.applyReaction("uuid-alice", 1_000, reaction(), false);

		expect(await store.applyReaction("uuid-alice", 1_000, reaction(), true)).toBe(true);
		expect((await only(store))?.reactions).toBeUndefined();
		expect(await store.applyReaction("uuid-alice", 1_000, reaction(), true)).toBe(false);
	});

	test("a reaction to a message the cache does not have is not an error", async () => {
		const store = open();
		await store.upsertConversation(conversation());

		// Nothing is invented: no row appears for the reaction itself.
		expect(await store.applyReaction("uuid-alice", 9_999, reaction(), false)).toBe(false);
		expect(await store.listAllMessages("uuid-alice")).toEqual([]);
	});

	test("a deleted message takes no reactions, and drops the ones it had", async () => {
		const store = open();
		await seed(store);
		await store.applyReaction("uuid-alice", 1_000, reaction(), false);

		await store.markMessageDeleted("uuid-alice", "uuid-alice:1000");

		expect((await only(store))?.reactions).toBeUndefined();
		expect(await store.applyReaction("uuid-alice", 1_000, reaction(), false)).toBe(false);
	});

	test("an expired message takes no reactions", async () => {
		const store = open();
		await seed(store, { expiresAt: 500 });
		expect(await store.purgeExpired(2_000)).toBe(1);

		expect(await store.applyReaction("uuid-alice", 1_000, reaction(), false)).toBe(false);
	});

	test("a swept message drops the reactions it carried", async () => {
		const store = open();
		await seed(store, { expiresAt: 3_000 });
		await store.applyReaction("uuid-alice", 1_000, reaction(), false);

		await store.purgeExpired(5_000);

		// The row stays so the thread keeps its shape, with nothing left on it.
		const swept = await only(store);
		expect(swept?.isExpired).toBe(true);
		expect(swept?.reactions).toBeUndefined();
	});

	test("every read path carries the reactions", async () => {
		const store = open();
		await seed(store);
		await store.applyReaction("uuid-alice", 1_000, reaction(), false);

		expect((await store.listMessages("uuid-alice"))[0]?.reactions).toHaveLength(1);
		expect((await store.search("hello"))[0]?.reactions).toHaveLength(1);
	});
});
