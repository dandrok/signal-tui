import { strongerReceipt } from "../../domain/receipts";
import type {
	Conversation,
	ConversationId,
	EditAuthor,
	Message,
	MessageId,
	Reaction,
	ReceiptState,
} from "../../domain/types";
import type { MessageStore } from "../../ports/store";
import { demoConversations, demoMessages } from "./demo-data";
import { mergeMessage } from "./merge-message";

const DEFAULT_LIMIT = 200;

/** Same shape the SQLite adapter returns: always a file array, reactions only when present. */
const hydrate = (message: Message, reactions: readonly Reaction[] | undefined): Message => ({
	...message,
	isEdited: message.isEdited === true,
	attachments: message.attachments ?? [],
	...(reactions === undefined || reactions.length === 0 ? {} : { reactions }),
});

/** Test/demo store. Shape-compatible with the SQLite adapter. */
export class InMemoryStore implements MessageStore {
	#conversations: Conversation[] = [...demoConversations];
	#messages: Message[] = [...demoMessages];
	/** Keyed by message id: reactions arrive after the message, one list per message. */
	#reactions = new Map<string, Reaction[]>();

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
			.map((message) => hydrate(message, this.#reactions.get(message.id)));
	}

	async listMessagesBefore(
		conversationId: ConversationId,
		beforeSentAt: number,
		limit = DEFAULT_LIMIT,
	): Promise<readonly Message[]> {
		if (limit <= 0) {
			return [];
		}
		return (
			this.#messages
				.filter((message) => message.conversationId === conversationId)
				.filter((message) => message.sentAt < beforeSentAt)
				// The store keeps insertion order; history is read in send order, which is what
				// the page after this one will expect of the rows it was cut from.
				.sort((left, right) => left.sentAt - right.sentAt)
				.slice(-limit)
				.map((message) => hydrate(message, this.#reactions.get(message.id)))
		);
	}

	async listAllMessages(conversationId: ConversationId): Promise<readonly Message[]> {
		return this.#messages
			.filter((entry) => entry.conversationId === conversationId)
			.map((entry) => hydrate(entry, this.#reactions.get(entry.id)));
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
				.map((message) => hydrate(message, this.#reactions.get(message.id)))
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
			// A view-once message keeps no content, however it was handed over.
			this.#messages.push(
				message.isViewOnce === true ? { ...message, body: "", attachments: [] } : message,
			);
			return { inserted: true };
		}
		// Every replay rule lives in `mergeMessage`, so this adapter and the SQLite one agree.
		this.#messages[index] = mergeMessage(existing, message);
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
		// An expired message is gone on purpose, a deleted one is gone for everyone, and a
		// view-once one was never kept; none may be refilled by an edit that arrives late.
		if (
			existing === undefined ||
			existing.isDeleted ||
			existing.isExpired === true ||
			existing.isViewOnce === true
		) {
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
			// Text, files and reactions all go: a message that is gone should not still name
			// the path of the photo it carried, nor keep a 👍 on it. The quote stays: it is
			// the identity of another message, holds none of this one's words, and the pane
			// reads its text from that row — which says "message expired" on its own.
			this.#reactions.delete(message.id);
			return { ...message, body: "", attachments: [], isExpired: true };
		});
		return purged;
	}

	async applyReaction(
		conversationId: ConversationId,
		targetSentAt: number,
		reaction: Reaction,
		isRemove: boolean,
	): Promise<boolean> {
		// Same rules as the SQLite adapter: the message is found by conversation and
		// timestamp, one reaction per person replaces, removal deletes, and a message that
		// is gone takes none.
		const target = this.#messages.find(
			(entry) =>
				entry.conversationId === conversationId &&
				entry.sentAt === targetSentAt &&
				!entry.isDeleted &&
				entry.isExpired !== true,
		);
		if (target === undefined) {
			return false;
		}

		const existing = this.#reactions.get(target.id) ?? [];
		const mine = existing.find((entry) => entry.authorId === reaction.authorId);
		if (isRemove) {
			if (mine === undefined) {
				return false;
			}
			const left = existing.filter((entry) => entry.authorId !== reaction.authorId);
			if (left.length === 0) {
				this.#reactions.delete(target.id);
			} else {
				this.#reactions.set(target.id, left);
			}
			return true;
		}

		if (mine !== undefined && mine.emoji === reaction.emoji) {
			return false;
		}
		this.#reactions.set(target.id, [
			...existing.filter((entry) => entry.authorId !== reaction.authorId),
			reaction,
		]);
		return true;
	}

	async markMessageDeleted(conversationId: ConversationId, messageId: MessageId): Promise<void> {
		const index = this.#messages.findIndex((message) => message.id === messageId);
		const existing = this.#messages[index];
		if (existing === undefined || existing.conversationId !== conversationId) {
			return;
		}
		// Attachments go with the text: a deleted message should stop pointing at
		// files, same as the SQLite adapter drops their rows. The quote marker stays —
		// it names another message and holds no words of this one.
		this.#messages[index] = { ...existing, isDeleted: true, body: "", attachments: [] };
		this.#reactions.delete(messageId);
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
