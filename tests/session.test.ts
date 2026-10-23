import { describe, expect, test } from "bun:test";
import { createSession } from "../src/app/session";
import { conversation, FakeBackend, message, RecordingStore } from "./helpers/session-fakes";

describe("createSession", () => {
	test("persists a received message and notifies listeners", async () => {
		const store = new RecordingStore();
		const backend = new FakeBackend();
		const session = createSession({ store, backend });
		let changes = 0;
		session.onChange(() => {
			changes++;
		});

		backend.emit({ kind: "message", message: message() });
		await session.flush();

		expect(store.ops).toEqual(["message:m1", "unread+1:uuid-alice"]);
		expect(changes).toBe(1);
	});

	test("applies a conversation before the message that needs it", async () => {
		const store = new RecordingStore();
		const backend = new FakeBackend();
		const session = createSession({ store, backend });

		backend.emit({ kind: "conversation-updated", conversation: conversation() });
		backend.emit({ kind: "message", message: message() });
		await session.flush();

		expect(store.ops).toEqual(["conversation:uuid-alice", "message:m1", "unread+1:uuid-alice"]);
	});

	test("marks a deleted message", async () => {
		const store = new RecordingStore();
		const backend = new FakeBackend();
		const session = createSession({ store, backend });

		backend.emit({
			kind: "message-deleted",
			conversationId: "uuid-alice",
			messageId: "uuid-alice:10",
		});
		await session.flush();

		expect(store.ops).toEqual(["deleted:uuid-alice:10"]);
	});

	test("records a store failure instead of rejecting", async () => {
		const store = new RecordingStore();
		store.failOn = "message";
		const backend = new FakeBackend();
		const session = createSession({ store, backend });

		backend.emit({ kind: "message", message: message() });
		await session.flush();

		expect(session.errors).toEqual(["store refused message:m1"]);
	});

	test("keeps going after a failed write", async () => {
		const store = new RecordingStore();
		store.failOn = "message";
		const backend = new FakeBackend();
		const session = createSession({ store, backend });

		backend.emit({ kind: "message", message: message() });
		// flush, so the failing write really happens before the flag changes:
		// writes are queued, and both emits would otherwise land after this line.
		await session.flush();

		store.failOn = null;
		backend.emit({ kind: "conversation-updated", conversation: conversation() });
		await session.flush();

		expect(store.ops).toEqual(["conversation:uuid-alice"]);
		expect(session.errors).toHaveLength(1);
	});

	test("subscribes before start, so nothing delivered on start is lost", async () => {
		const store = new RecordingStore();
		const backend = new FakeBackend();
		backend.start = async () => {
			backend.emit({ kind: "message", message: message() });
		};
		const session = createSession({ store, backend });

		await session.start();
		await session.flush();

		expect(store.ops).toEqual(["message:m1", "unread+1:uuid-alice"]);
	});

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

	test("marks read and notifies when something was actually unread", async () => {
		const store = new RecordingStore();
		const backend = new FakeBackend();
		const session = createSession({ store, backend });
		let changes = 0;
		session.onChange(() => {
			changes++;
		});
		store.unread.set("uuid-alice", 2);

		await session.markRead("uuid-alice");

		expect(changes).toBe(1);
	});

	test("a replayed message does not count twice", async () => {
		const store = new RecordingStore();
		const backend = new FakeBackend();
		const session = createSession({ store, backend });

		backend.emit({ kind: "message", message: message("m1") });
		await session.flush();
		backend.emit({ kind: "message", message: message("m1") });
		await session.flush();

		expect(store.ops).toEqual(["message:m1", "unread+1:uuid-alice", "message:m1"]);
	});

	test("does not increment unread for your own message", async () => {
		const store = new RecordingStore();
		const backend = new FakeBackend();
		const session = createSession({ store, backend });

		backend.emit({
			kind: "message",
			message: { ...message("m2"), isOutgoing: true, author: "You" },
		});
		await session.flush();

		expect(store.ops).toEqual(["message:m2"]);
	});

	test("markRead clears the conversation and notifies", async () => {
		const store = new RecordingStore();
		const backend = new FakeBackend();
		const session = createSession({ store, backend });
		let changes = 0;
		session.onChange(() => {
			changes++;
		});

		await session.markRead("uuid-alice");

		expect(store.ops).toEqual(["read:uuid-alice"]);
		// nothing was unread, so no change: notifying here is what looped the UI
		expect(changes).toBe(0);
	});

	test("stop unsubscribes before stopping the backend", async () => {
		const store = new RecordingStore();
		const backend = new FakeBackend();
		const session = createSession({ store, backend });
		await session.start();

		await session.stop();

		expect(backend.listenerCount).toBe(0);
		expect(backend.stopped).toBe(1);
	});
});
