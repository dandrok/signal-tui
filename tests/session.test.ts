import { describe, expect, test } from "bun:test";
import { createSession } from "../src/app/session";
import type { Conversation, Message } from "../src/domain/types";
import type { BackendEvent, SignalBackend } from "../src/ports/backend";
import type { MessageStore } from "../src/ports/store";

const conversation = (id = "uuid-alice"): Conversation => ({
	id,
	name: "Alice",
	unreadCount: 1,
	lastActivityAt: 10,
});

const message = (id = "m1"): Message => ({
	id,
	conversationId: "uuid-alice",
	author: "Alice",
	body: "hi",
	sentAt: 10,
	isOutgoing: false,
	isDeleted: false,
});

class RecordingStore implements MessageStore {
	readonly ops: string[] = [];
	failOn: string | null = null;

	async listConversations(): Promise<readonly Conversation[]> {
		return [];
	}

	async listMessages(): Promise<readonly Message[]> {
		return [];
	}

	async search(): Promise<readonly Message[]> {
		return [];
	}

	async upsertConversation(entry: Conversation): Promise<void> {
		this.#record(`conversation:${entry.id}`);
	}

	async saveMessage(entry: Message): Promise<void> {
		this.#record(`message:${entry.id}`);
	}

	async markMessageDeleted(_conversationId: string, messageId: string): Promise<void> {
		this.#record(`deleted:${messageId}`);
	}

	#record(op: string): void {
		if (this.failOn !== null && op.startsWith(this.failOn)) {
			throw new Error(`store refused ${op}`);
		}
		this.ops.push(op);
	}
}

class FakeBackend implements SignalBackend {
	started = 0;
	stopped = 0;
	readonly sent: Array<{ conversationId: string; body: string }> = [];
	failStart = false;
	#listeners = new Set<(event: BackendEvent) => void>();

	async start(): Promise<void> {
		this.started++;
		if (this.failStart) {
			throw new Error("subscribe failed");
		}
	}

	async stop(): Promise<void> {
		this.stopped++;
	}

	async sendMessage(conversationId: string, body: string): Promise<void> {
		this.sent.push({ conversationId, body });
	}

	subscribe(listener: (event: BackendEvent) => void): () => void {
		this.#listeners.add(listener);
		return () => {
			this.#listeners.delete(listener);
		};
	}

	emit(event: BackendEvent): void {
		for (const listener of this.#listeners) {
			listener(event);
		}
	}

	get listenerCount(): number {
		return this.#listeners.size;
	}
}

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

		expect(store.ops).toEqual(["message:m1"]);
		expect(changes).toBe(1);
	});

	test("applies a conversation before the message that needs it", async () => {
		const store = new RecordingStore();
		const backend = new FakeBackend();
		const session = createSession({ store, backend });

		backend.emit({ kind: "conversation-updated", conversation: conversation() });
		backend.emit({ kind: "message", message: message() });
		await session.flush();

		expect(store.ops).toEqual(["conversation:uuid-alice", "message:m1"]);
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

		expect(store.ops).toEqual(["message:m1"]);
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
		expect(store.ops[1]).toMatch(/^message:uuid-alice:\d+$/);
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
