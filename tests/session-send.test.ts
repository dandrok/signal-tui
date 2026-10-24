import { describe, expect, test } from "bun:test";
import { createSession } from "../src/app/session";
import { DIRECT_ID, FakeBackend, RecordingStore } from "./helpers/session-fakes";

/** Sending: what goes to the backend, and what the store is told afterwards. */
describe("createSession sending", () => {
	test("sends through the backend", async () => {
		const store = new RecordingStore();
		const backend = new FakeBackend();
		const session = createSession({ store, backend });

		await session.send("uuid-alice", "hello");

		expect(backend.sent).toEqual([{ conversationId: "uuid-alice", body: "hello" }]);
	});

	test("echoes a sent message into the store so it appears immediately", async () => {
		const store = new RecordingStore();
		const backend = new FakeBackend();
		const session = createSession({ store, backend });
		let changes = 0;
		session.onChange(() => {
			changes++;
		});

		await session.send("uuid-alice", "hello");

		expect(backend.sent).toEqual([{ conversationId: "uuid-alice", body: "hello" }]);
		expect(store.ops).toHaveLength(2);
		expect(store.ops[0]).toBe("conversation:uuid-alice");
		expect(store.ops).not.toContain("unread+1:uuid-alice");
		// the server timestamp, not a local clock reading: deletes refer to it
		expect(store.ops[1]).toBe("message:uuid-alice:1760000000500");
		expect(changes).toBe(1);
	});

	test("does not echo a message the backend refused to send", async () => {
		const store = new RecordingStore();
		const backend = new FakeBackend();
		backend.sendMessage = async () => {
			throw new Error("network down");
		};
		const session = createSession({ store, backend });

		await expect(session.send("uuid-alice", "hello")).rejects.toThrow("network down");

		expect(store.ops).toEqual([]);
	});

	test("a sent message records whose it is", async () => {
		const store = new RecordingStore();
		const backend = new FakeBackend();
		const session = createSession({ store, backend });

		await session.send(DIRECT_ID, "hello from here");
		await session.flush();

		const [saved] = store.savedMessages;
		// Without an id the row would only match edits by the label "You", which a peer
		// in a group can adopt for itself.
		expect(saved?.authorId).toBe("self");
		expect(saved?.author).toBe("You");
	});
});
