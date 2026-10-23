import type { Conversation, ConversationId, Message, MessageId } from "../../domain/types";
import type { MessageStore } from "../../ports/store";
import { demoConversations, demoMessages } from "./demo-data";

const DEFAULT_LIMIT = 200;

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
			.slice(-limit);
	}

	async listAllMessages(conversationId: ConversationId): Promise<readonly Message[]> {
		return this.#messages.filter((entry) => entry.conversationId === conversationId);
	}

	async search(query: string, limit = 20): Promise<readonly Message[]> {
		const needle = query.trim().toLowerCase();
		if (needle.length === 0) {
			return [];
		}
		return this.#messages
			.filter((message) => message.body.toLowerCase().includes(needle))
			.slice(0, limit);
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
		if (index === -1) {
			this.#messages.push(message);
			return { inserted: true };
		}
		this.#messages[index] = message;
		return { inserted: false };
	}

	async markMessageDeleted(conversationId: ConversationId, messageId: MessageId): Promise<void> {
		const index = this.#messages.findIndex((message) => message.id === messageId);
		const existing = this.#messages[index];
		if (existing === undefined || existing.conversationId !== conversationId) {
			return;
		}
		this.#messages[index] = { ...existing, isDeleted: true, body: "" };
	}
}
