import type { Conversation, Message } from "../../src/domain/types";
import type { BackendEvent, SignalBackend } from "../../src/ports/backend";
import type { MessageStore } from "../../src/ports/store";

export const conversation = (id = "uuid-alice"): Conversation => ({
	id,
	name: "Alice",
	unreadCount: 1,
	lastActivityAt: 10,
});

export const message = (id = "m1"): Message => ({
	id,
	conversationId: "uuid-alice",
	author: "Alice",
	body: "hi",
	sentAt: 10,
	isOutgoing: false,
	isDeleted: false,
});

export class RecordingStore implements MessageStore {
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

	readonly saved = new Set<string>();
	async saveMessage(entry: Message): Promise<{ inserted: boolean }> {
		const inserted = !this.saved.has(entry.id);
		this.saved.add(entry.id);
		this.#record(`message:${entry.id}`);
		return { inserted };
	}

	async markMessageDeleted(_conversationId: string, messageId: string): Promise<void> {
		this.#record(`deleted:${messageId}`);
	}

	async incrementUnread(conversationId: string, by: number): Promise<void> {
		this.#record(`unread+${by}:${conversationId}`);
	}

	unread = new Map<string, number>();
	async markConversationRead(conversationId: string): Promise<boolean> {
		this.#record(`read:${conversationId}`);
		const before = this.unread.get(conversationId) ?? 0;
		this.unread.set(conversationId, 0);
		return before > 0;
	}

	#record(op: string): void {
		if (this.failOn !== null && op.startsWith(this.failOn)) {
			throw new Error(`store refused ${op}`);
		}
		this.ops.push(op);
	}
}

export class FakeBackend implements SignalBackend {
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

	async sendMessage(
		conversationId: string,
		body: string,
	): Promise<{ timestamp: number | undefined }> {
		this.sent.push({ conversationId, body });
		return { timestamp: 1_760_000_000_500 };
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
