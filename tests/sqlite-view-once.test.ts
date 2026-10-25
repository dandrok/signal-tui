import { afterEach, describe, expect, test } from "bun:test";
import { SqliteMessageStore } from "../src/adapters/sqlite/store";
import type { Attachment, Conversation, Message } from "../src/domain/types";

const conversation = (overrides: Partial<Conversation> = {}): Conversation => ({
	id: "uuid-alice",
	name: "Alice",
	unreadCount: 0,
	lastActivityAt: 1_000,
	...overrides,
});

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
	id: "uuid-alice:1000",
	conversationId: "uuid-alice",
	author: "Alice",
	authorId: "uuid-alice",
	body: "",
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

const only = async (store: SqliteMessageStore): Promise<Message | undefined> =>
	(await store.listAllMessages("uuid-alice"))[0];

/**
 * The store enforces the same rule as the mapper: a retention rule that only one layer
 * knows about is one adapter away from leaking, and this is the layer that writes bytes.
 */
describe("SqliteMessageStore view-once", () => {
	test("refuses to store the content of a view-once message", async () => {
		const store = open();
		await store.upsertConversation(conversation());
		// A caller that hands over the content anyway: the row must still come back empty.
		await store.saveMessage(
			message({ isViewOnce: true, body: "look at this", attachments: [photo()] }),
		);

		const stored = await only(store);
		expect(stored?.body).toBe("");
		expect(stored?.attachments).toEqual([]);
		expect(stored?.isViewOnce).toBe(true);
	});

	test("the content is not searchable", async () => {
		const store = open();
		await store.upsertConversation(conversation());
		await store.saveMessage(
			message({ isViewOnce: true, body: "holiday plans", attachments: [photo()] }),
		);

		// Neither the body nor a file's caption reached the index.
		expect(await store.search("holiday")).toEqual([]);
	});

	test("a replay that names an old row scrubs the text it once kept", async () => {
		const store = open();
		await store.upsertConversation(conversation());
		// A cache written by a release that did keep view-once content.
		await store.saveMessage(message({ body: "kept by an older release", attachments: [photo()] }));
		expect((await only(store))?.body).toBe("kept by an older release");

		// The same envelope arrives again, now recognised as view-once.
		await store.saveMessage(message({ isViewOnce: true }));

		const stored = await only(store);
		expect(stored?.body).toBe("");
		expect(stored?.attachments).toEqual([]);
		expect(stored?.isViewOnce).toBe(true);
	});

	test("a replay that carries content still stores none", async () => {
		const store = open();
		await store.upsertConversation(conversation());
		// A row from an ordinary envelope, then the same id recognised as view-once with
		// text still attached: the update branch has to blank it, not write what it was
		// handed. Without this, only the insert path is exercised.
		await store.saveMessage(message({ body: "ordinary text" }));
		await store.saveMessage(message({ isViewOnce: true, body: "later content" }));

		expect((await only(store))?.body).toBe("");
	});

	test("an edit cannot put text back into a view-once message", async () => {
		const store = open();
		await store.upsertConversation(conversation());
		await store.saveMessage(message({ isViewOnce: true }));

		const applied = await store.applyEdit(
			"uuid-alice",
			1_000,
			{ id: "uuid-alice", label: "Alice" },
			"injected text",
		);

		expect(applied).toBe(false);
		expect((await only(store))?.body).toBe("");
	});
});
