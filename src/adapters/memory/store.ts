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
		if (index === -1) {
			this.#conversations.push(conversation);
			return;
		}
		this.#conversations[index] = conversation;
	}

	async saveMessage(message: Message): Promise<void> {
		const index = this.#messages.findIndex((existing) => existing.id === message.id);
		if (index === -1) {
			this.#messages.push(message);
			return;
		}
		this.#messages[index] = message;
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
