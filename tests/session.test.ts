import { describe, expect, test } from "bun:test";
import { InMemoryStore } from "../src/adapters/memory/store";
import { createSession } from "../src/app/session";
import type { Message } from "../src/domain/types";
import { SELF_AUTHOR_ID } from "../src/domain/types";
import {
	conversation,
	DIRECT_ID,
	FakeBackend,
	GROUP_ID,
	message,
	RecordingStore,
} from "./helpers/session-fakes";

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
		let changes = 0;
		session.onChange(() => {
			changes++;
		});

		backend.emit({
			kind: "message-deleted",
			conversationId: "uuid-alice",
			messageId: "uuid-alice:10",
			deleter: { id: "uuid-alice", label: "Alice" },
		});
		await session.flush();

		expect(store.ops).toEqual(["deleted:uuid-alice:10:uuid-alice"]);
		expect(changes).toBe(1);
	});

	test("a delete the store refused redraws nothing", async () => {
		const store = new RecordingStore();
		// A row this store does not have: the peer's delete named a message never cached, or one
		// a sweep already took. The write reports that, and a reload would show the same frames.
		store.deleteResult = false;
		const backend = new FakeBackend();
		const session = createSession({ store, backend });
		let changes = 0;
		session.onChange(() => {
			changes++;
		});

		backend.emit({
			kind: "message-deleted",
			conversationId: "uuid-alice",
			messageId: "uuid-alice:10",
			deleter: { id: "uuid-alice", label: "Alice" },
		});
		await session.flush();

		expect(store.ops).toEqual(["deleted:uuid-alice:10:uuid-alice"]);
		expect(changes).toBe(0);
	});

	test("in a group, only the author's own delete takes their message", async () => {
		// The rule against a real store: the fake above can only repeat what it was told, so this
		// is the chain a peer's envelope actually travels — event, session, store, row.
		const store = new InMemoryStore();
		const backend = new FakeBackend();
		const session = createSession({ store, backend });
		const group = "group-signal-devs";
		await store.upsertConversation({
			id: group,
			name: "Signal devs",
			unreadCount: 0,
			lastActivityAt: 2_000,
		});
		const author = (body: string, sentAt: number, id: string, label: string): Message => ({
			id: `${group}:${sentAt}`,
			conversationId: group,
			author: label,
			authorId: id,
			body,
			sentAt,
			isOutgoing: false,
			isDeleted: false,
		});
		await store.saveMessage(author("mine", 1_000, "uuid-alice", "Alice"));
		await store.saveMessage(author("not yours", 2_000, "uuid-bob", "Bob"));

		// Bob names Alice's message: refused, and her row keeps its words.
		backend.emit({
			kind: "message-deleted",
			conversationId: group,
			messageId: `${group}:1000`,
			deleter: { id: "uuid-bob", label: "Bob" },
		});
		await session.flush();

		expect((await store.listAllMessages(group)).find((row) => row.sentAt === 1_000)?.body).toBe(
			"mine",
		);

		// Alice names her own: taken, and Bob's row is untouched.
		backend.emit({
			kind: "message-deleted",
			conversationId: group,
			messageId: `${group}:1000`,
			deleter: { id: "uuid-alice", label: "Alice" },
		});
		await session.flush();

		const rows = await store.listAllMessages(group);
		const mine = rows.find((row) => row.sentAt === 1_000);
		const theirs = rows.find((row) => row.sentAt === 2_000);
		expect(mine?.isDeleted).toBe(true);
		expect(mine?.body).toBe("");
		expect(theirs?.isDeleted).toBe(false);
		expect(theirs?.body).toBe("not yours");
	});

	test("our own delete still reaches the wire when the cache has no such row", async () => {
		const store = new RecordingStore();
		store.deleteResult = false;
		const backend = new FakeBackend();
		const session = createSession({ store, backend });
		let changes = 0;
		session.onChange(() => {
			changes++;
		});
		const target = { sentAt: 10, authorId: SELF_AUTHOR_ID };

		await session.remove("uuid-alice", target);

		// The envelope still goes out — the other devices have the message even when this cache
		// does not — and the pane is not redrawn for a write that changed nothing.
		expect(backend.deletions).toEqual([{ conversationId: "uuid-alice", target }]);
		expect(changes).toBe(0);
	});

	test("our own delete notifies when the row was there", async () => {
		const store = new RecordingStore();
		const backend = new FakeBackend();
		const session = createSession({ store, backend });
		let changes = 0;
		session.onChange(() => {
			changes++;
		});

		await session.remove("uuid-alice", { sentAt: 10, authorId: SELF_AUTHOR_ID });

		expect(changes).toBe(1);
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
		// The outcome, not just the sequence: one message, one unread.
		expect(store.unread.get("uuid-alice")).toBe(1);
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

	test("sends a read receipt for incoming messages when a conversation is read", async () => {
		const store = new RecordingStore();
		const backend = new FakeBackend();
		const session = createSession({ store, backend });
		store.unread.set(DIRECT_ID, 2);
		store.messages.set(DIRECT_ID, [
			{ ...message("m1"), sentAt: 100 },
			{ ...message("m2"), sentAt: 200 },
			{ ...message("m3"), sentAt: 300, isOutgoing: true },
			{ ...message("m4"), sentAt: 400, isDeleted: true },
		]);

		await session.markRead(DIRECT_ID);

		// Only what the other side actually sent, and what still exists.
		expect(backend.receipts).toEqual([
			{ recipient: DIRECT_ID, timestamps: [100, 200], type: "read" },
		]);
	});

	test("acknowledges a backlog larger than one page", async () => {
		const store = new RecordingStore();
		const backend = new FakeBackend();
		const session = createSession({ store, backend });
		const backlog = Array.from({ length: 150 }, (_, index) => ({
			...message(`bulk-${index}`),
			sentAt: 1_000 + index,
		}));
		store.unread.set(DIRECT_ID, 150);
		store.messages.set(DIRECT_ID, backlog);

		await session.markRead(DIRECT_ID);

		// Leaving any out would drop them permanently: clearing read state is the end.
		expect(backend.receipts[0]?.timestamps).toHaveLength(150);
	});

	test("sends no receipt when nothing was unread", async () => {
		const store = new RecordingStore();
		const backend = new FakeBackend();
		const session = createSession({ store, backend });
		// Same conversation and messages as the working case: the only difference is
		// that nothing is unread, so the receipt path must be skipped deliberately.
		store.messages.set(DIRECT_ID, [{ ...message("m1"), sentAt: 100 }]);

		await session.markRead(DIRECT_ID);

		expect(backend.receipts).toEqual([]);
	});

	test("skips receipts for group conversations", async () => {
		const store = new RecordingStore();
		const backend = new FakeBackend();
		const session = createSession({ store, backend });
		store.unread.set(GROUP_ID, 1);
		store.messages.set(GROUP_ID, [{ ...message("m1"), sentAt: 100 }]);

		await session.markRead(GROUP_ID);

		expect(backend.receipts).toEqual([]);

		// Control: the same shape of conversation with a direct id does send.
		const control = new RecordingStore();
		const controlBackend = new FakeBackend();
		const controlSession = createSession({ store: control, backend: controlBackend });
		control.unread.set(DIRECT_ID, 1);
		control.messages.set(DIRECT_ID, [{ ...message("m1"), sentAt: 100 }]);
		await controlSession.markRead(DIRECT_ID);
		expect(controlBackend.receipts).toHaveLength(1);
	});

	test("records a rejected receipt without failing the read", async () => {
		const store = new RecordingStore();
		const backend = new FakeBackend();
		backend.failReceipts = true;
		const session = createSession({ store, backend });
		store.unread.set(DIRECT_ID, 1);
		store.messages.set(DIRECT_ID, [{ ...message("m1"), sentAt: 100 }]);

		await session.markRead(DIRECT_ID);

		expect(session.errors).toEqual(["receipt: receipt rejected"]);
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
