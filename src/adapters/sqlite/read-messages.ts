import type { Database } from "bun:sqlite";
import type { ConversationId } from "../../domain/types";
import { toFtsQuery } from "./fts";
import { type ConversationRow, type MessageRow, toConversation, toMessage } from "./rows";

/**
 * The read side. Queries live apart from the write rules so a change to what a row
 * looks like happens in one place instead of being copied into every SELECT.
 */
export const selectMessageColumns =
	"id, conversation_id, author, author_id, body, sent_at, is_outgoing, is_deleted, is_edited, expires_at, is_expired";

export function readConversations(db: Database): ConversationRow[] {
	return db
		.query<ConversationRow, []>(
			`SELECT id, name, unread_count, last_activity_at, expires_in_seconds
			 FROM conversations
			 ORDER BY last_activity_at DESC, id ASC`,
		)
		.all();
}

export function readMessages(
	db: Database,
	conversationId: ConversationId,
	limit: number,
): MessageRow[] {
	// Newest N, then flipped back into reading order.
	return db
		.query<MessageRow, [string, number]>(
			`SELECT * FROM (
				SELECT ${selectMessageColumns}
				FROM messages
				WHERE conversation_id = ?1
				ORDER BY sent_at DESC, id DESC
				LIMIT ?2
			 ) ORDER BY sent_at ASC, id ASC`,
		)
		.all(conversationId, limit);
}

export function readAllMessages(db: Database, conversationId: ConversationId): MessageRow[] {
	return db
		.query<MessageRow, [string]>(
			`SELECT ${selectMessageColumns}
			 FROM messages
			 WHERE conversation_id = ?1
			 ORDER BY sent_at ASC, id ASC`,
		)
		.all(conversationId);
}

export function searchMessages(db: Database, query: string, limit: number): MessageRow[] {
	const ftsQuery = toFtsQuery(query);
	if (ftsQuery === null || limit <= 0) {
		return [];
	}
	return db
		.query<MessageRow, [string, number]>(
			`SELECT m.id, m.conversation_id, m.author, m.author_id, m.body, m.sent_at, m.is_outgoing, m.is_deleted, m.is_edited, m.expires_at, m.is_expired
			 FROM messages_fts
			 JOIN messages m ON m.rowid = messages_fts.rowid
			 WHERE messages_fts MATCH ?1
			   AND m.is_deleted = 0
			 ORDER BY bm25(messages_fts), m.sent_at DESC
			 LIMIT ?2`,
		)
		.all(ftsQuery, limit);
}

export { toConversation, toMessage };
