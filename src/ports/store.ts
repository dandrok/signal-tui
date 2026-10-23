import type { Conversation, ConversationId, Message, MessageId } from "../domain/types";

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
	/** Updates metadata (name, activity). Never changes the unread count. */
	upsertConversation(conversation: Conversation): Promise<void>;
	/** Adds to the unread count; incoming messages only. */
	incrementUnread(conversationId: ConversationId, by: number): Promise<void>;
	/** Clears the unread count. Resolves true when something actually changed. */
	markConversationRead(conversationId: ConversationId): Promise<boolean>;
	/** Upserts a message; `inserted` is false when it was already cached. */
	saveMessage(message: Message): Promise<{ readonly inserted: boolean }>;
	/** Marks a message as deleted; a no-op when the message is not cached. */
	markMessageDeleted(conversationId: ConversationId, messageId: MessageId): Promise<void>;
}

export interface MessageStore extends MessageReader, MessageWriter {}
