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
	id: "m1",
	conversationId: "uuid-alice",
	author: "Alice",
	authorId: "uuid-alice",
	body: "hello",
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

/** Disappearing messages: the timer has to delete the text, not just hide it. */
describe("SqliteMessageStore expiry", () => {
	test("clears the body and files of a message whose timer ran out", async () => {
		const store = open();
		await store.upsertConversation(conversation());
		await store.saveMessage(
			message({
				body: "this will vanish",
				expiresAt: 2_000,
				attachments: [
					{
						id: "a1",
						contentType: "image/png",
						filename: "x.png",
						size: 1,
						caption: null,
						isVoiceNote: false,
					},
				],
			}),
		);

		expect(await store.purgeExpired(1_999)).toBe(0);
		expect((await store.listMessages("uuid-alice"))[0]?.body).toBe("this will vanish");

		expect(await store.purgeExpired(2_000)).toBe(1);

		const [purged] = await store.listMessages("uuid-alice");
		expect(purged?.body).toBe("");
		expect(purged?.isExpired).toBe(true);
		expect(purged?.attachments).toEqual([]);
		// and the text is gone from the index, not merely blank on the row
		expect(await store.search("vanish")).toHaveLength(0);
	});

	test("leaves a message with a live timer alone", async () => {
		const store = open();
		await store.upsertConversation(conversation());
		await store.saveMessage(message({ body: "still here", expiresAt: 9_000 }));

		expect(await store.purgeExpired(5_000)).toBe(0);
		expect((await store.listMessages("uuid-alice"))[0]?.body).toBe("still here");
	});

	test("does not purge twice, and keeps messages that never had a timer", async () => {
		const store = open();
		await store.upsertConversation(conversation());
		await store.saveMessage(message({ id: "uuid-alice:1", body: "timed", expiresAt: 2_000 }));
		await store.saveMessage(message({ id: "uuid-alice:2", sentAt: 1_500, body: "forever" }));

		expect(await store.purgeExpired(2_000)).toBe(1);
		// a second sweep has nothing left to do
		expect(await store.purgeExpired(2_000)).toBe(0);

		const saved = await store.listMessages("uuid-alice");
		expect(saved.find((entry) => entry.id === "uuid-alice:2")?.body).toBe("forever");
		expect(saved.find((entry) => entry.id === "uuid-alice:2")?.isExpired).toBeUndefined();
	});

	test("an edit cannot refill a message that expired", async () => {
		const store = open();
		await store.upsertConversation(conversation());
		await store.saveMessage(message({ body: "original", expiresAt: 2_000 }));
		await store.purgeExpired(2_500);

		expect(
			await store.applyEdit("uuid-alice", 1_000, { id: "uuid-alice", label: "Alice" }, "back"),
		).toBe(false);
		expect((await store.listMessages("uuid-alice"))[0]?.body).toBe("");
	});
});

/** The timer our own messages inherit, kept with the conversation. */
describe("SqliteMessageStore conversation timer", () => {
	test("remembers a timer and does not switch it off when a later update omits it", async () => {
		const store = open();
		await store.upsertConversation({ ...conversation(), expiresInSeconds: 86_400 });
		expect(await store.expiresInSeconds("uuid-alice")).toBe(86_400);

		// A transcript knows only the destination id; it must not clear the timer.
		await store.upsertConversation(conversation());
		expect(await store.expiresInSeconds("uuid-alice")).toBe(86_400);
	});

	test("a zero switches the timer off, and an unknown conversation has none", async () => {
		const store = open();
		await store.upsertConversation({ ...conversation(), expiresInSeconds: 86_400 });
		await store.upsertConversation({ ...conversation(), expiresInSeconds: 0 });

		expect(await store.expiresInSeconds("uuid-alice")).toBe(0);
		expect(await store.expiresInSeconds("uuid-nobody")).toBeUndefined();
	});
});
