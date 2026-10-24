import type { Conversation, ConversationId, Message, MessageId } from "../../domain/types";
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
		this.#conversations[index] = {
			...conversation,
			name,
			lastActivityAt,
			unreadCount: existing.unreadCount,
		};
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
		const frozen = existing.isDeleted === true || existing.isEdited === true;
		const base: Message = {
			...message,
			isDeleted: deleted,
			body: frozen ? existing.body : message.body,
			...(existing.isEdited === true ? { isEdited: true } : {}),
		};
		const kept = deleted ? [] : attachments;
		this.#messages[index] = kept === undefined ? base : { ...base, attachments: kept };
		return { inserted: false };
	}

	async applyEdit(
		conversationId: ConversationId,
		targetSentAt: number,
		body: string,
	): Promise<boolean> {
		const index = this.#messages.findIndex(
			(entry) => entry.conversationId === conversationId && entry.sentAt === targetSentAt,
		);
		const existing = this.#messages[index];
		if (existing === undefined || existing.isDeleted) {
			return false;
		}
		this.#messages[index] = { ...existing, body, isEdited: true };
		return true;
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
}
