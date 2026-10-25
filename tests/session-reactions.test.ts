import { describe, expect, test } from "bun:test";
import { createSession } from "../src/app/session";
import { DIRECT_ID, FakeBackend, message, RecordingStore } from "./helpers/session-fakes";

describe("createSession reactions", () => {
	test("a reaction from the other side lands on the message it names", async () => {
		const store = new RecordingStore();
		const backend = new FakeBackend();
		const session = createSession({ store, backend });
		store.messages.set(DIRECT_ID, [
			{ ...message(), id: "m1", conversationId: DIRECT_ID, sentAt: 100 },
		]);

		let changes = 0;
		session.onChange(() => {
			changes += 1;
		});

		backend.emit({
			kind: "reaction",
			conversationId: DIRECT_ID,
			targetSentAt: 100,
			reactor: { id: "uuid-alice", label: "Alice" },
			emoji: "👍",
			isRemove: false,
		});
		await session.flush();

		expect(store.ops).toContain(`reaction:${DIRECT_ID}:100:👍:add`);
		expect(store.reactionChanges).toEqual([{ conversationId: DIRECT_ID, targetSentAt: 100 }]);
		expect(changes).toBe(1);
	});

	test("a reaction for a message we never cached inserts nothing and redraws nothing", async () => {
		const store = new RecordingStore();
		const backend = new FakeBackend();
		const session = createSession({ store, backend });
		store.messages.set(DIRECT_ID, []);

		let changes = 0;
		session.onChange(() => {
			changes += 1;
		});

		backend.emit({
			kind: "reaction",
			conversationId: DIRECT_ID,
			targetSentAt: 404,
			reactor: { id: "uuid-alice", label: "Alice" },
			emoji: "👍",
			isRemove: false,
		});
		await session.flush();

		// The event is applied and the store refuses it: no message row is invented for it.
		expect(store.ops).toContain(`reaction:${DIRECT_ID}:404:👍:add`);
		expect(store.reactionChanges).toEqual([]);
		expect(store.savedMessages).toHaveLength(0);
		// Nothing changed in the cache, so nothing in the pane can have changed either: a
		// reconnect replaying a backlog of reactions must not reload the thread per envelope.
		expect(changes).toBe(0);
	});
});
