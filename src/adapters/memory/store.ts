import type { Conversation, ConversationId, Message } from "../../domain/types";
import type { MessageStore } from "../../ports/store";
import { demoConversations, demoMessages } from "./demo-data";

const DEFAULT_LIMIT = 200;

/** Test/demo store. Shape-compatible with the future SQLite adapter. */
export class InMemoryStore implements MessageStore {
	async listConversations(): Promise<readonly Conversation[]> {
		return demoConversations;
	}

	async listMessages(
		conversationId: ConversationId,
		limit = DEFAULT_LIMIT,
	): Promise<readonly Message[]> {
		return demoMessages
			.filter((message) => message.conversationId === conversationId)
			.slice(-limit);
	}

	async search(query: string, limit = 20): Promise<readonly Message[]> {
		const needle = query.trim().toLowerCase();
		if (needle.length === 0) {
			return [];
		}
		return demoMessages
			.filter((message) => message.body.toLowerCase().includes(needle))
			.slice(0, limit);
	}
}
