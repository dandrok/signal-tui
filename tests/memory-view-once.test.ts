import { describe, expect, test } from "bun:test";
import { InMemoryStore } from "../src/adapters/memory/store";
import type { Attachment, Conversation, Message } from "../src/domain/types";

/** Same rules as the SQLite adapter: demo mode must not behave differently. */
const conversation: Conversation = {
	id: "uuid-carol",
	name: "Carol",
	unreadCount: 0,
	lastActivityAt: 1_000,
};

const photo = (overrides: Partial<Attachment> = {}): Attachment => ({
	id: "a1",
	contentType: "image/jpeg",
	filename: "/home/you/.local/share/signal-cli/attachments/holiday.jpg",
	size: 812_000,
	caption: "holiday snap",
	isVoiceNote: false,
	...overrides,
});

const message = (overrides: Partial<Message> = {}): Message => ({
	id: "uuid-carol:1000",
	conversationId: "uuid-carol",
	author: "Carol",
	authorId: "uuid-carol",
	body: "",
	sentAt: 1_000,
	isOutgoing: false,
	isDeleted: false,
	...overrides,
});

const only = async (store: InMemoryStore): Promise<Message | undefined> =>
	(await store.listAllMessages("uuid-carol"))[0];

describe("InMemoryStore view-once", () => {
	test("refuses to store the content of a view-once message", async () => {
		const store = new InMemoryStore();
		await store.upsertConversation(conversation);
		await store.saveMessage(
			message({ isViewOnce: true, body: "look at this", attachments: [photo()] }),
		);

		const stored = await only(store);
		expect(stored?.body).toBe("");
		expect(stored?.attachments).toEqual([]);
		expect(stored?.isViewOnce).toBe(true);
	});

	test("the content is not searchable", async () => {
		const store = new InMemoryStore();
		await store.upsertConversation(conversation);
		await store.saveMessage(message({ isViewOnce: true, body: "holiday plans" }));

		expect(await store.search("holiday")).toEqual([]);
	});

	test("a replay that names an old row scrubs the text it once kept", async () => {
		const store = new InMemoryStore();
		await store.upsertConversation(conversation);
		await store.saveMessage(message({ body: "kept by an older release", attachments: [photo()] }));

		await store.saveMessage(message({ isViewOnce: true }));

		const stored = await only(store);
		expect(stored?.body).toBe("");
		expect(stored?.attachments).toEqual([]);
		expect(stored?.isViewOnce).toBe(true);
	});

	test("a replay that carries content still stores none", async () => {
		const store = new InMemoryStore();
		await store.upsertConversation(conversation);
		// The insert path strips content on its own; this exercises the merge branch, where
		// a payload carrying text must still land as a view-once row with no body.
		await store.saveMessage(message({ body: "ordinary text" }));
		await store.saveMessage(message({ isViewOnce: true, body: "later content" }));

		expect((await only(store))?.body).toBe("");
	});

	test("the flag survives a replay that says nothing about it", async () => {
		const store = new InMemoryStore();
		await store.upsertConversation(conversation);
		await store.saveMessage(message({ isViewOnce: true }));
		// A reconnect replays the original envelope: spreading it over the row would drop
		// the flag and the notice with it.
		await store.saveMessage(message({ body: "" }));

		expect((await only(store))?.isViewOnce).toBe(true);
	});

	test("an edit cannot put text back into a view-once message", async () => {
		const store = new InMemoryStore();
		await store.upsertConversation(conversation);
		await store.saveMessage(message({ isViewOnce: true }));

		const applied = await store.applyEdit(
			"uuid-carol",
			1_000,
			{ id: "uuid-carol", label: "Carol" },
			"injected text",
		);

		expect(applied).toBe(false);
		expect((await only(store))?.body).toBe("");
	});
});
