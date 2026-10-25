import { strongerReceipt } from "../../domain/receipts";
import type {
	Conversation,
	ConversationId,
	EditAuthor,
	Message,
	MessageId,
	ReceiptState,
} from "../../domain/types";
import type { MessageStore } from "../../ports/store";
import { demoConversations, demoMessages } from "./demo-data";

const DEFAULT_LIMIT = 200;

/** Same shape the SQLite adapter returns: always an array, never a missing field. */
const withFiles = (message: Message): Message => ({
	...message,
	isEdited: message.isEdited === true,
	attachments: message.attachments ?? [],
});

/** Test/demo store. Shape-compatible with the SQLite adapter. */
export class InMemoryStore implements MessageStore {
	#conversations: Conversation[] = [...demoConversations];
	#messages: Message[] = [...demoMessages];

	async listConversations(): Promise<readonly Conversation[]> {
		return [...this.#conversations].sort((a, b) => b.lastActivityAt - a.lastActivityAt);
	}

	async listMessages(
		conversationId: ConversationId,
		limit = DEFAULT_LIMIT,
	): Promise<readonly Message[]> {
		return this.#messages
			.filter((message) => message.conversationId === conversationId)
			.slice(-limit)
			.map(withFiles);
	}

	async listAllMessages(conversationId: ConversationId): Promise<readonly Message[]> {
		return this.#messages.filter((entry) => entry.conversationId === conversationId).map(withFiles);
	}

	async search(query: string, limit = 20): Promise<readonly Message[]> {
		const needle = query.trim().toLowerCase();
		if (needle.length === 0) {
			return [];
		}
		return (
			this.#messages
				// A deleted message must not be discoverable through search.
				.filter((message) => !message.isDeleted && message.body.toLowerCase().includes(needle))
				.slice(0, limit)
				.map(withFiles)
		);
	}

	async upsertConversation(conversation: Conversation): Promise<void> {
		const index = this.#conversations.findIndex((existing) => existing.id === conversation.id);
		const existing = this.#conversations[index];
		if (existing === undefined) {
			this.#conversations.push(conversation);
			return;
		}
		// An empty name means "unknown" (a sync transcript has only the destination
		// id): never let it erase a name learned from an incoming message.
		const name = conversation.name.trim().length > 0 ? conversation.name : existing.name;
		// A late-arriving transcript must not move a conversation backwards in the
		// list; same rule as the SQLite upsert. The unread count is owned by
		// incrementUnread/markConversationRead, so metadata updates leave it alone.
		const lastActivityAt = Math.max(existing.lastActivityAt, conversation.lastActivityAt);
		// Same rule as the SQLite upsert: an update that says nothing about the timer
		// must not switch the timer off.
		const expiresInSeconds = conversation.expiresInSeconds ?? existing.expiresInSeconds;
		this.#conversations[index] = {
			...conversation,
			name,
			lastActivityAt,
			unreadCount: existing.unreadCount,
			...(expiresInSeconds === undefined ? {} : { expiresInSeconds }),
		};
	}

	async expiresInSeconds(conversationId: ConversationId): Promise<number | undefined> {
		return this.#conversations.find((entry) => entry.id === conversationId)?.expiresInSeconds;
	}

	async incrementUnread(conversationId: ConversationId, by: number): Promise<void> {
		const index = this.#conversations.findIndex((entry) => entry.id === conversationId);
		const existing = this.#conversations[index];
		if (existing === undefined) {
			return;
		}
		this.#conversations[index] = { ...existing, unreadCount: existing.unreadCount + by };
	}

	async markConversationRead(conversationId: ConversationId): Promise<boolean> {
		const index = this.#conversations.findIndex((entry) => entry.id === conversationId);
		const existing = this.#conversations[index];
		if (existing === undefined || existing.unreadCount === 0) {
			return false;
		}
		this.#conversations[index] = { ...existing, unreadCount: 0 };
		return true;
	}

	async saveMessage(message: Message): Promise<{ readonly inserted: boolean }> {
		const index = this.#messages.findIndex((existing) => existing.id === message.id);
		const existing = this.#messages[index];
		if (existing === undefined) {
			this.#messages.push(message);
			return { inserted: true };
		}
		// An absent `attachments` field means "this update says nothing about files",
		// not "this message has none" — the rule the SQLite adapter already applies,
		// or a partial update would silently drop files the store had.
		const attachments = message.attachments ?? existing.attachments;
		// Two rules, both about replays, and both mirrored in the SQLite adapter: a
		// correction outranks the original text, and deletion is one-way — Signal has no
		// undelete, so a redelivered envelope must not revive a tombstone.
		const deleted = existing.isDeleted === true || message.isDeleted === true;
		// Deleted, expired, or corrected: in all three the stored body is the newer truth.
		const frozen =
			existing.isDeleted === true || existing.isExpired === true || existing.isEdited === true;
		const base: Message = {
			...message,
			isDeleted: deleted,
			body: frozen ? existing.body : message.body,
			...(existing.isEdited === true ? { isEdited: true } : {}),
			// Same for expiry: the flag lives in the row, not in the payload.
			...(existing.isExpired === true ? { isExpired: true } : {}),
			// The stored deadline wins. A replay can supply one where none was known,
			// never replace one: extending it would outlive what the sender promised.
			...((existing.expiresAt ?? message.expiresAt) === undefined
				? {}
				: { expiresAt: (existing.expiresAt ?? message.expiresAt) as number }),
			// A replay that carries no author id says nothing about the sender, not that
			// there is none: dropping the stored one would silently downgrade the row to
			// label matching, which the SQLite adapter avoids with COALESCE.
			...(message.authorId === undefined && existing.authorId !== undefined
				? { authorId: existing.authorId }
				: {}),
			// Same shape as the author id, and the fourth field to fail this way: a
			// payload never carries a receipt, so spreading `...message` would erase the
			// one the store already recorded and the ticks would vanish on a reconnect.
			// The SQLite adapter leaves the column alone, so both agree.
			...(message.receipt === undefined && existing.receipt !== undefined
				? { receipt: existing.receipt }
				: {}),
		};
		const kept = deleted || existing.isExpired === true ? [] : attachments;
		this.#messages[index] = kept === undefined ? base : { ...base, attachments: kept };
		return { inserted: false };
	}

	async applyEdit(
		conversationId: ConversationId,
		targetSentAt: number,
		editor: EditAuthor,
		body: string,
	): Promise<boolean> {
		// A timestamp identifies a message within a conversation, not an author, so the
		// author has to match too — otherwise one member's edit could rewrite another
		// member's message. Rows stored before schema v4 have no id: they fall back to
		// the label they were cached with, exactly as the SQLite adapter does.
		const index = this.#messages.findIndex(
			(entry) =>
				entry.conversationId === conversationId &&
				entry.sentAt === targetSentAt &&
				(entry.authorId === undefined
					? entry.author === editor.label
					: entry.authorId === editor.id),
		);
		const existing = this.#messages[index];
		// An expired message is gone on purpose, and a deleted one is gone for everyone;
		// neither may be refilled by an edit that arrives late.
		if (existing === undefined || existing.isDeleted || existing.isExpired === true) {
			return false;
		}
		this.#messages[index] = { ...existing, body, isEdited: true };
		return true;
	}

	async purgeExpired(now: number): Promise<number> {
		let purged = 0;
		this.#messages = this.#messages.map((message) => {
			if (
				message.expiresAt === undefined ||
				message.expiresAt > now ||
				message.isExpired === true
			) {
				return message;
			}
			purged += 1;
			// Text and files both go: a message that is gone should not still name the
			// path of the photo it carried.
			return { ...message, body: "", attachments: [], isExpired: true };
		});
		return purged;
	}

	async markMessageDeleted(conversationId: ConversationId, messageId: MessageId): Promise<void> {
		const index = this.#messages.findIndex((message) => message.id === messageId);
		const existing = this.#messages[index];
		if (existing === undefined || existing.conversationId !== conversationId) {
			return;
		}
		// Attachments go with the text: a deleted message should stop pointing at
		// files, same as the SQLite adapter drops their rows.
		this.#messages[index] = { ...existing, isDeleted: true, body: "", attachments: [] };
	}

	async applyReceipt(
		timestamps: readonly number[],
		state: ReceiptState,
	): Promise<readonly ConversationId[]> {
		// Same rules as the SQLite adapter, because this store is what demo mode and
		// half the tests run against: a receipt may only touch our own messages, and
		// only to strengthen what is stored.
		const wanted = new Set(timestamps);
		const changed = new Set<ConversationId>();
		this.#messages = this.#messages.map((message) => {
			if (!message.isOutgoing || !wanted.has(message.sentAt)) {
				return message;
			}
			const next = strongerReceipt(message.receipt, state);
			if (next === message.receipt) {
				return message;
			}
			changed.add(message.conversationId);
			return { ...message, receipt: next };
		});
		return [...changed];
	}
}
