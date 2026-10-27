import { describe, expect, test } from "bun:test";
import { InMemoryStore } from "../src/adapters/memory/store";
import { createSession } from "../src/app/session";
import { SELF_LABEL } from "../src/domain/format";
import { SELF_AUTHOR_ID } from "../src/domain/types";
import { DIRECT_ID, FakeBackend } from "./helpers/session-fakes";

describe("createSession reactions", () => {
	test("sends the reaction and keeps the local echo", async () => {
		// Signal never echoes a send back to the device that wrote it, so without the echo our
		// own reaction would not appear until something re-read the thread.
		const store = new InMemoryStore();
		await store.upsertConversation({
			id: DIRECT_ID,
			name: "Alice",
			unreadCount: 0,
			lastActivityAt: 10,
		});
		await store.saveMessage({
			id: `${DIRECT_ID}:10`,
			conversationId: DIRECT_ID,
			author: "Alice",
			authorId: "uuid-alice",
			body: "hi",
			sentAt: 10,
			isOutgoing: false,
			isDeleted: false,
			attachments: [],
		});
		const backend = new FakeBackend();
		const session = createSession({ store, backend });

		await session.react(DIRECT_ID, { sentAt: 10, authorId: "uuid-alice" }, "👍");

		expect(backend.reactions).toEqual([
			{
				conversationId: DIRECT_ID,
				target: { sentAt: 10, authorId: "uuid-alice" },
				emoji: "👍",
				isRemove: false,
			},
		]);
		const [stored] = await store.listMessages(DIRECT_ID);
		expect(stored?.reactions?.[0]).toMatchObject({
			emoji: "👍",
			author: SELF_LABEL,
			authorId: SELF_AUTHOR_ID,
		});
	});

	test("does not redraw for a message the cache does not have", async () => {
		const store = new InMemoryStore();
		const backend = new FakeBackend();
		const session = createSession({ store, backend });
		let redraws = 0;
		session.onChange(() => {
			redraws += 1;
		});

		await session.react(DIRECT_ID, { sentAt: 10, authorId: "uuid-alice" }, "👍");

		// The send went out, but the row is not in this cache: the store answers "no change",
		// and a redraw would be a full reload of the pane for nothing.
		expect(backend.reactions).toHaveLength(1);
		expect(redraws).toBe(0);
	});

	test("a refused send does not write an echo", async () => {
		const store = new InMemoryStore();
		const backend = new FakeBackend();
		backend.failReactions = true;
		const session = createSession({ store, backend });

		await expect(
			session.react(DIRECT_ID, { sentAt: 10, authorId: "uuid-alice" }, "👍"),
		).rejects.toThrow("reaction rejected");
		expect(await store.listMessages(DIRECT_ID)).toEqual([]);
	});
});
