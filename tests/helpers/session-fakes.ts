import type { Conversation, EditAuthor, Message } from "../../src/domain/types";
import type { BackendEvent, SignalBackend } from "../../src/ports/backend";
import type { MessageStore } from "../../src/ports/store";

export const conversation = (id = "uuid-alice"): Conversation => ({
	id,
	name: "Alice",
	unreadCount: 1,
	lastActivityAt: 10,
});

/** Realistic conversation key: receipts resolve recipients as numbers or UUIDs. */
export const DIRECT_ID = "4b1c9f1e-0000-4000-8000-000000000000";

/** Group ids are base64 and are not accepted as a receipt recipient. */
export const GROUP_ID = "dGhpcyBpcyBhIGdyb3VwIGlkPQ==";

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

	readonly messages = new Map<string, Message[]>();

	async listMessages(conversationId: string): Promise<readonly Message[]> {
		return this.messages.get(conversationId) ?? [];
	}

	async listAllMessages(conversationId: string): Promise<readonly Message[]> {
		return this.messages.get(conversationId) ?? [];
	}

	async search(): Promise<readonly Message[]> {
		return [];
	}

	async upsertConversation(entry: Conversation): Promise<void> {
		this.#record(`conversation:${entry.id}`);
	}

	readonly saved = new Set<string>();
	/** What the session actually handed the store, in order. */
	readonly savedMessages: Message[] = [];

	async saveMessage(entry: Message): Promise<{ inserted: boolean }> {
		const inserted = !this.saved.has(entry.id);
		this.saved.add(entry.id);
		this.savedMessages.push(entry);
		this.#record(`message:${entry.id}`);
		return { inserted };
	}

	async applyEdit(
		conversationId: string,
		targetSentAt: number,
		editor: EditAuthor,
		body: string,
	): Promise<boolean> {
		if (this.failOn === "applyEdit") {
			throw new Error("applyEdit failed");
		}
		this.ops.push(`applyEdit:${conversationId}:${targetSentAt}:${body}`);
		const existing = this.messages.get(conversationId) ?? [];
		const index = existing.findIndex(
			(entry) =>
				entry.sentAt === targetSentAt &&
				(entry.authorId === undefined
					? entry.author === editor.label
					: entry.authorId === editor.id),
		);
		const found = existing[index];
		if (found === undefined) {
			return false;
		}
		this.messages.set(conversationId, [
			...existing.slice(0, index),
			{ ...found, body, isEdited: true },
			...existing.slice(index + 1),
		]);
		return true;
	}

	async markMessageDeleted(_conversationId: string, messageId: string): Promise<void> {
		this.#record(`deleted:${messageId}`);
	}

	async incrementUnread(conversationId: string, by: number): Promise<void> {
		this.#record(`unread+${by}:${conversationId}`);
		this.unread.set(conversationId, (this.unread.get(conversationId) ?? 0) + by);
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

	readonly receipts: Array<{ recipient: string; timestamps: readonly number[]; type: string }> = [];
	failReceipts = false;

	async sendReceipt(
		recipient: string,
		timestamps: readonly number[],
		type = "read",
	): Promise<void> {
		if (this.failReceipts) {
			throw new Error("receipt rejected");
		}
		this.receipts.push({ recipient, timestamps, type });
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
