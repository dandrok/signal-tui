import { beforeEach, describe, expect, test } from "bun:test";
import { SqliteMessageStore, toFtsQuery } from "../src/adapters/sqlite/store";
import type { Conversation, Message } from "../src/domain/types";

const conversation = (id: string): Conversation => ({
	id,
	name: id,
	unreadCount: 0,
	lastActivityAt: 1,
});

const message = (id: string, body: string, overrides: Partial<Message> = {}): Message => ({
	id,
	conversationId: "alice",
	author: "Alice",
	body,
	sentAt: 1,
	isOutgoing: false,
	isDeleted: false,
	...overrides,
});

describe("toFtsQuery", () => {
	test("turns words into quoted prefix terms", () => {
		expect(toFtsQuery("deploy broken")).toBe('"deploy"* "broken"*');
	});

	test("returns null when there is nothing to search for", () => {
		expect(toFtsQuery("   ")).toBeNull();
		expect(toFtsQuery("!!!")).toBeNull();
	});

	test("neutralises FTS5 operators and quotes", () => {
		expect(toFtsQuery('NEAR(a b) OR "x"')).toBe('"near"* "a"* "b"* "or"* "x"*');
		expect(toFtsQuery("foo*")).toBe('"foo"*');
		expect(toFtsQuery("a-b")).toBe('"a"* "b"*');
	});
});

describe("SqliteMessageStore search", () => {
	let store: SqliteMessageStore;

	beforeEach(async () => {
		store = new SqliteMessageStore({ path: ":memory:" });
		await store.upsertConversation(conversation("alice"));
		await store.upsertConversation(conversation("bob"));
		await store.saveMessage(message("m1", "the deploy is broken again"));
		await store.saveMessage(
			message("m2", "deploy deploy deploy night", { conversationId: "bob", sentAt: 2 }),
		);
		await store.saveMessage(message("m3", "lunch at seven"));
	});

	test("finds a message by word", async () => {
		expect((await store.search("lunch")).map((entry) => entry.id)).toEqual(["m3"]);
	});

	test("matches prefixes", async () => {
		expect((await store.search("dep")).map((entry) => entry.id).sort()).toEqual(["m1", "m2"]);
	});

	test("requires every word", async () => {
		expect((await store.search("deploy broken")).map((entry) => entry.id)).toEqual(["m1"]);
	});

	test("is case-insensitive", async () => {
		expect((await store.search("LUNCH")).map((entry) => entry.id)).toEqual(["m3"]);
	});

	test("ranks the best match first", async () => {
		expect((await store.search("deploy"))[0]?.id).toBe("m2");
	});

	test("searches across conversations", async () => {
		expect((await store.search("deploy", 10)).map((entry) => entry.id).sort()).toEqual([
			"m1",
			"m2",
		]);
	});

	test("honours the limit", async () => {
		expect(await store.search("deploy", 1)).toHaveLength(1);
	});

	test("returns nothing for an empty query", async () => {
		expect(await store.search("   ")).toEqual([]);
	});

	test("does not throw on hostile input", async () => {
		for (const query of ['"', "NEAR(", "OR AND NOT", "*", "a:b", "(unclosed"]) {
			expect(await store.search(query)).toEqual(expect.any(Array));
		}
	});

	test("never returns a deleted message", async () => {
		await store.markMessageDeleted("alice", "m1");

		// Deleting must remove it from search, not just from the conversation. Bob's
		// message still matches, so assert on the id rather than emptiness.
		const hits = await store.search("deploy", 10);
		expect(hits.map((entry) => entry.id)).not.toContain("m1");
	});

	test("keeps the index in sync when a body is edited", async () => {
		await store.saveMessage(message("m3", "dinner at eight"));

		expect(await store.search("lunch")).toEqual([]);
		expect((await store.search("dinner")).map((entry) => entry.id)).toEqual(["m3"]);
	});
});
