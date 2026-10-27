import { describe, expect, test } from "bun:test";
import { InMemoryStore } from "../src/adapters/memory/store";
import { SqliteMessageStore } from "../src/adapters/sqlite/store";
import type { Message } from "../src/domain/types";
import type { MessageStore } from "../src/ports/store";

/**
 * "Delete for me": the same two questions both stores have to answer — does the row disappear
 * from every read, and does a second press report a change.
 *
 * Run against both adapters because the flag lives in a column in one and a set in the other,
 * and the read paths are the only thing that has to agree.
 */

const CONVERSATION = "+48123456789";

const message = (sentAt: number, body: string): Message => ({
	id: `${CONVERSATION}:${sentAt}`,
	conversationId: CONVERSATION,
	author: "Amber",
	authorId: "uuid-amber",
	body,
	sentAt,
	isOutgoing: false,
	isDeleted: false,
	attachments: [],
});

const adapters = [
	{ name: "sqlite", open: (): MessageStore => new SqliteMessageStore({ path: ":memory:" }) },
	{ name: "memory", open: (): MessageStore => new InMemoryStore({ seed: false }) },
] as const;

for (const adapter of adapters) {
	describe(`${adapter.name} hiding a message`, () => {
		const seeded = async (): Promise<MessageStore> => {
			const store = adapter.open();
			await store.upsertConversation({
				id: CONVERSATION,
				name: "Amber",
				unreadCount: 0,
				lastActivityAt: 3_000,
			});
			await store.saveMessage(message(1_000, "keep me"));
			await store.saveMessage(message(2_000, "hide me"));
			await store.saveMessage(message(3_000, "keep me too"));
			return store;
		};

		test("a hidden message leaves every read", async () => {
			const store = await seeded();

			expect(await store.hideMessage(CONVERSATION, `${CONVERSATION}:2000`)).toBe(true);

			const thread = await store.listMessages(CONVERSATION);
			expect(thread.map((entry) => entry.body)).toEqual(["keep me", "keep me too"]);
			expect((await store.listAllMessages(CONVERSATION)).map((entry) => entry.sentAt)).toEqual([
				1_000, 3_000,
			]);
			// Search must not resurface it: a hidden row is not "deleted for everyone", it is
			// simply not this device's conversation any more.
			expect(await store.search("hide", 10)).toEqual([]);
		});

		test("an older page skips it too", async () => {
			const store = await seeded();
			await store.hideMessage(CONVERSATION, `${CONVERSATION}:2000`);

			const page = await store.listMessagesBefore(CONVERSATION, 3_000);

			expect(page.map((entry) => entry.sentAt)).toEqual([1_000]);
		});

		test("hiding the same message twice reports no change the second time", async () => {
			// The answer is what stops `D` pressed twice from redrawing the pane.
			const store = await seeded();

			expect(await store.hideMessage(CONVERSATION, `${CONVERSATION}:2000`)).toBe(true);
			expect(await store.hideMessage(CONVERSATION, `${CONVERSATION}:2000`)).toBe(false);
		});

		test("a message in another conversation is not hidden through this one", async () => {
			const store = await seeded();

			expect(await store.hideMessage("+48999999999", `${CONVERSATION}:2000`)).toBe(false);
			expect(await store.listMessages(CONVERSATION)).toHaveLength(3);
		});

		test("a hidden message is still there for the store's own rules", async () => {
			// It was not deleted: a replay of the same envelope must merge into the row rather
			// than arrive as new, and an edit from its author still applies.
			const store = await seeded();
			await store.hideMessage(CONVERSATION, `${CONVERSATION}:2000`);

			const replay = await store.saveMessage(message(2_000, "hide me, replayed"));
			expect(replay.inserted).toBe(false);

			const edited = await store.applyEdit(
				CONVERSATION,
				2_000,
				{ id: "uuid-amber", label: "Amber" },
				"still hidden",
			);
			expect(edited).toBe(true);
			expect(await store.listMessages(CONVERSATION)).toHaveLength(2);
		});
	});
}
