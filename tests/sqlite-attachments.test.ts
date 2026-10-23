import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteMessageStore } from "../src/adapters/sqlite/store";
import type { Attachment, Conversation, Message } from "../src/domain/types";

const conversation: Conversation = {
	id: "uuid-alice",
	name: "Alice",
	unreadCount: 0,
	lastActivityAt: 1_000,
};

const attachment = (overrides: Partial<Attachment> = {}): Attachment => ({
	id: "a1",
	contentType: "image/png",
	filename: "/tmp/attachments/screenshot.png",
	size: 412_000,
	caption: null,
	isVoiceNote: false,
	...overrides,
});

const message = (overrides: Partial<Message> = {}): Message => ({
	id: "m1",
	conversationId: "uuid-alice",
	author: "Alice",
	body: "",
	sentAt: 1_000,
	isOutgoing: false,
	isDeleted: false,
	attachments: [attachment()],
	...overrides,
});

let dir: string;
let path: string;
let store: SqliteMessageStore;

beforeEach(async () => {
	dir = mkdtempSync(join(tmpdir(), "signal-tui-att-"));
	path = join(dir, "cache.db");
	store = new SqliteMessageStore({ path });
	await store.upsertConversation(conversation);
});

afterEach(() => {
	store.close();
	rmSync(dir, { recursive: true, force: true });
});

describe("SqliteMessageStore attachments", () => {
	test("returns the files a message carried, in order", async () => {
		await store.saveMessage(
			message({
				attachments: [
					attachment({ id: "a1", filename: "/tmp/one.png" }),
					attachment({ id: "a2", filename: null, isVoiceNote: true, caption: null }),
				],
			}),
		);

		const [stored] = await store.listMessages("uuid-alice");

		expect(stored?.attachments).toEqual([
			attachment({ id: "a1", filename: "/tmp/one.png" }),
			attachment({ id: "a2", filename: null, isVoiceNote: true, caption: null }),
		]);
	});

	test("keeps them across a restart", async () => {
		await store.saveMessage(message());
		store.close();

		store = new SqliteMessageStore({ path });
		const [stored] = await store.listMessages("uuid-alice");

		expect(stored?.attachments).toEqual([attachment()]);
	});

	test("replaces the set when the same message arrives again", async () => {
		await store.saveMessage(
			message({ attachments: [attachment({ id: "old" }), attachment({ id: "old-2" })] }),
		);
		await store.saveMessage(message({ attachments: [attachment({ id: "new" })] }));

		const [stored] = await store.listMessages("uuid-alice");

		expect(stored?.attachments?.map((entry) => entry.id)).toEqual(["new"]);
	});

	test("leaves them alone when an update says nothing about files", async () => {
		await store.saveMessage(message());
		// A later envelope for the same message with no attachment field at all must
		// not be read as "this message has no files".
		const { attachments, ...withoutFiles } = message({ body: "edited" });
		await store.saveMessage(withoutFiles);

		const [stored] = await store.listMessages("uuid-alice");

		expect(stored?.body).toBe("edited");
		expect(stored?.attachments).toEqual([attachment()]);
	});

	test("drops them when the message is deleted", async () => {
		await store.saveMessage(message());
		await store.markMessageDeleted("uuid-alice", "m1");

		const [stored] = await store.listMessages("uuid-alice");

		expect(stored?.attachments).toEqual([]);
	});

	test("search results carry their files", async () => {
		await store.saveMessage(message({ body: "see attached" }));

		const [hit] = await store.search("attached");

		expect(hit?.attachments).toEqual([attachment()]);
	});
});
