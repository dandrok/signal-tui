import { describe, expect, test } from "bun:test";
import { InMemoryStore } from "../src/adapters/memory/store";
import type { Conversation, Message } from "../src/domain/types";

const CONVERSATION = "c-scrollback";

const conversation: Conversation = {
	id: CONVERSATION,
	name: "Alice",
	unreadCount: 0,
	lastActivityAt: 0,
};

const message = (index: number): Message => ({
	id: `${CONVERSATION}:${1_000 + index * 10}`,
	conversationId: CONVERSATION,
	author: "Alice",
	authorId: "uuid-alice",
	body: `message-${index}`,
	sentAt: 1_000 + index * 10,
	isOutgoing: false,
	isDeleted: false,
});

const seeded = async (count: number): Promise<InMemoryStore> => {
	const store = new InMemoryStore();
	await store.upsertConversation(conversation);
	for (let index = 0; index < count; index++) {
		await store.saveMessage(message(index));
	}
	return store;
};

/** The same page rules as the SQLite adapter: a rule one adapter has is half a rule. */
describe("InMemoryStore scrollback", () => {
	test("walks back in pages, oldest first", async () => {
		const store = await seeded(120);

		const newest = await store.listMessages(CONVERSATION, 50);
		const second = await store.listMessagesBefore(CONVERSATION, newest[0]?.sentAt ?? 0, 50);
		const third = await store.listMessagesBefore(CONVERSATION, second[0]?.sentAt ?? 0, 50);

		expect(newest[0]?.body).toBe("message-70");
		expect(second.at(-1)?.body).toBe("message-69");
		expect(third).toHaveLength(20);
		expect(third[0]?.body).toBe("message-0");
	});

	test("a page carries the files and reactions of its rows", async () => {
		// Hydration is the store's shape promise: a paged row must look like a read one.
		const store = await seeded(3);
		await store.saveMessage({
			...message(0),
			id: `${CONVERSATION}:2000`,
			sentAt: 2_000,
			attachments: [
				{
					id: "a1",
					contentType: "image/png",
					filename: "/tmp/a.png",
					size: 10,
					caption: null,
					isVoiceNote: false,
				},
			],
		});

		const page = await store.listMessagesBefore(CONVERSATION, 2_100, 50);
		const withFiles = page.find((entry) => entry.sentAt === 2_000);

		expect(withFiles?.attachments).toHaveLength(1);
	});
});
