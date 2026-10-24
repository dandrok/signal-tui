import type { Conversation, ConversationId, EditAuthor, Message, MessageId } from "../domain/types";

/**
 * Read model for the local cache. Implementations: memory (tests/demo) and
 * SQLite + FTS5 (real). Kept as a port so the storage engine can change
 * without touching domain or UI.
 */
export interface MessageReader {
	listConversations(): Promise<readonly Conversation[]>;
	listMessages(conversationId: ConversationId, limit?: number): Promise<readonly Message[]>;
	/**
	 * Every cached message in a conversation, oldest first. Needed where a page is
	 * not enough — e.g. acknowledging a backlog with read receipts.
	 */
	listAllMessages(conversationId: ConversationId): Promise<readonly Message[]>;
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
	/**
	 * Replaces the body of a cached message, identified by the timestamp the edit
	 * targets and the author it belongs to. Resolves false when that message is not
	 * cached, or when the edit comes from somebody other than its author — a peer must
	 * not be able to rewrite another participant's message by guessing its timestamp.
	 */
	applyEdit(
		conversationId: ConversationId,
		targetSentAt: number,
		editor: EditAuthor,
		body: string,
	): Promise<boolean>;
	/** Marks a message as deleted; a no-op when the message is not cached. */
	markMessageDeleted(conversationId: ConversationId, messageId: MessageId): Promise<void>;
}

export interface MessageStore extends MessageReader, MessageWriter {}
