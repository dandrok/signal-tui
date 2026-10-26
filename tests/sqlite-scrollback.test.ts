import { afterEach, describe, expect, test } from "bun:test";
import { SqliteMessageStore } from "../src/adapters/sqlite/store";
import type { Conversation, Message } from "../src/domain/types";

const CONVERSATION = "uuid-alice";

const conversation: Conversation = {
	id: CONVERSATION,
	name: "Alice",
	unreadCount: 0,
	lastActivityAt: 0,
};

const message = (index: number): Message => ({
	id: `${CONVERSATION}:${1_000 + index * 10}`,
	conversationId: CONVERSATION,
	author: index % 2 === 0 ? "Alice" : "You",
	authorId: index % 2 === 0 ? "uuid-alice" : "self",
	body: `message-${index}`,
	sentAt: 1_000 + index * 10,
	isOutgoing: index % 2 !== 0,
	isDeleted: false,
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

const seeded = async (count: number): Promise<SqliteMessageStore> => {
	const store = open();
	await store.upsertConversation(conversation);
	for (let index = 0; index < count; index++) {
		await store.saveMessage(message(index));
	}
	return store;
};

/**
 * History past the first page. Keyset, not offset: the cursor is the oldest row already on
 * screen, so rows arriving while the user scrolls cannot shift a page into a duplicate or
 * a hole.
 */
describe("SqliteMessageStore scrollback", () => {
	test("walks back in pages, oldest first, without gaps or repeats", async () => {
		const store = await seeded(120);

		const newest = await store.listMessages(CONVERSATION, 50);
		expect(newest).toHaveLength(50);
		expect(newest[0]?.body).toBe("message-70");

		const second = await store.listMessagesBefore(CONVERSATION, newest[0]?.sentAt ?? 0, 50);
		expect(second).toHaveLength(50);
		expect(second.at(-1)?.body).toBe("message-69");

		const third = await store.listMessagesBefore(CONVERSATION, second[0]?.sentAt ?? 0, 50);
		expect(third).toHaveLength(20);
		expect(third[0]?.body).toBe("message-0");

		// The three pages are the whole thread, in order, each row exactly once.
		const walked = [...third, ...second, ...newest].map((entry) => entry.body);
		expect(walked).toEqual(Array.from({ length: 120 }, (_unused, index) => `message-${index}`));
	});

	test("a short page is the beginning, and asking again returns nothing", async () => {
		const store = await seeded(10);

		// Ten rows seeded, all older than the cursor: one short page, which is how the pane
		// learns the thread has a beginning.
		const page = await store.listMessagesBefore(CONVERSATION, 1_100, 50);

		expect(page).toHaveLength(10);
		expect(page[0]?.body).toBe("message-0");
		expect(await store.listMessagesBefore(CONVERSATION, 1_000, 50)).toEqual([]);
	});

	test("stays inside the conversation it was asked about", async () => {
		const store = await seeded(5);
		await store.upsertConversation({ ...conversation, id: "uuid-bob", name: "Bob" });
		await store.saveMessage({
			...message(1),
			id: "uuid-bob:9000",
			conversationId: "uuid-bob",
			sentAt: 9_000,
		});

		const page = await store.listMessagesBefore(CONVERSATION, 9_500, 50);

		expect(page.map((entry) => entry.conversationId)).toEqual(Array(5).fill(CONVERSATION));
	});
});
