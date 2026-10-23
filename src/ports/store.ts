import type { Conversation, ConversationId, Message } from "../domain/types";

/**
 * Read model for the local cache. Implementations: memory (tests/demo) and
 * SQLite + FTS5 (real). Kept as a port so the storage engine can change
 * without touching domain or UI.
 */
export interface MessageReader {
	listConversations(): Promise<readonly Conversation[]>;
	listMessages(conversationId: ConversationId, limit?: number): Promise<readonly Message[]>;
	search(query: string, limit?: number): Promise<readonly Message[]>;
}

/**
 * Writes applied when envelopes arrive. The caller owns ordering: a message's
 * conversation must exist before the message is saved.
 */
export interface MessageWriter {
	upsertConversation(conversation: Conversation): Promise<void>;
	saveMessage(message: Message): Promise<void>;
}

export interface MessageStore extends MessageReader, MessageWriter {}
