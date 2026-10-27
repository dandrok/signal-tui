import { strongerReceipt } from "../../src/domain/receipts";
import type {
	Conversation,
	EditAuthor,
	Message,
	Reaction,
	ReceiptState,
} from "../../src/domain/types";
import type {
	BackendEvent,
	ReactionTarget,
	ReplyTarget,
	SignalBackend,
} from "../../src/ports/backend";
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

	async listMessagesBefore(
		conversationId: string,
		beforeSentAt: number,
		limit = 50,
	): Promise<readonly Message[]> {
		return (this.messages.get(conversationId) ?? [])
			.filter((entry) => entry.sentAt < beforeSentAt)
			.sort((left, right) => left.sentAt - right.sentAt)
			.slice(-limit);
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
		// Read it back the way a real store would: tests that assert on stored state
		// after a save should not have to seed the map themselves.
		const existing = this.messages.get(entry.conversationId) ?? [];
		const index = existing.findIndex((candidate) => candidate.id === entry.id);
		this.messages.set(
			entry.conversationId,
			index === -1
				? [...existing, entry]
				: [...existing.slice(0, index), entry, ...existing.slice(index + 1)],
		);
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

	readonly purges: number[] = [];

	readonly timers = new Map<string, number>();

	async expiresInSeconds(conversationId: string): Promise<number | undefined> {
		return this.timers.get(conversationId);
	}

	async purgeExpired(now: number): Promise<number> {
		this.purges.push(now);
		let purged = 0;
		for (const [conversationId, entries] of this.messages) {
			this.messages.set(
				conversationId,
				entries.map((entry) => {
					if (entry.expiresAt === undefined || entry.expiresAt > now || entry.isExpired === true) {
						return entry;
					}
					purged += 1;
					return { ...entry, body: "", attachments: [], isExpired: true };
				}),
			);
		}
		return purged;
	}

	readonly reactionChanges: Array<{ conversationId: string; targetSentAt: number }> = [];

	/** Records the call and answers whether a message was there to react to. */
	async applyReaction(
		conversationId: string,
		targetSentAt: number,
		reaction: Reaction,
		isRemove: boolean,
	): Promise<boolean> {
		this.#record(
			`reaction:${conversationId}:${targetSentAt}:${reaction.emoji}:${isRemove ? "remove" : "add"}`,
		);
		const entries = this.messages.get(conversationId) ?? [];
		const target = entries.find((entry) => entry.sentAt === targetSentAt);
		if (target === undefined) {
			return false;
		}
		this.reactionChanges.push({ conversationId, targetSentAt });
		return true;
	}

	async markMessageDeleted(_conversationId: string, messageId: string): Promise<void> {
		this.#record(`deleted:${messageId}`);
	}

	readonly receipts: Array<{ timestamps: readonly number[]; state: ReceiptState }> = [];

	/** Mirrors both real adapters, so a session test can assert the stored state. */
	async applyReceipt(
		timestamps: readonly number[],
		state: ReceiptState,
	): Promise<readonly string[]> {
		this.receipts.push({ timestamps, state });
		const wanted = new Set(timestamps);
		const changed = new Set<string>();
		for (const [conversationId, entries] of this.messages) {
			this.messages.set(
				conversationId,
				entries.map((entry) => {
					if (!entry.isOutgoing || !wanted.has(entry.sentAt)) {
						return entry;
					}
					const next = strongerReceipt(entry.receipt, state);
					if (next === entry.receipt) {
						return entry;
					}
					changed.add(conversationId);
					return { ...entry, receipt: next };
				}),
			);
		}
		return [...changed];
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
	readonly sent: Array<{ conversationId: string; body: string; replyTo?: ReplyTarget }> = [];
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
		replyTo?: ReplyTarget,
	): Promise<{ timestamp: number | undefined }> {
		this.sent.push({ conversationId, body, ...(replyTo === undefined ? {} : { replyTo }) });
		return { timestamp: 1_760_000_000_500 };
	}

	readonly reactions: Array<{
		conversationId: string;
		target: ReactionTarget;
		emoji: string;
		isRemove: boolean;
	}> = [];
	failReactions = false;

	async sendReaction(
		conversationId: string,
		target: ReactionTarget,
		emoji: string,
		isRemove = false,
	): Promise<void> {
		if (this.failReactions) {
			throw new Error("reaction rejected");
		}
		this.reactions.push({ conversationId, target, emoji, isRemove });
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
