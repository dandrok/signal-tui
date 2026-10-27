import type { Database } from "bun:sqlite";
import type { ConversationId } from "../../domain/types";
import { toFtsQuery } from "./fts";
import { type ConversationRow, type MessageRow, toConversation, toMessage } from "./rows";

/**
 * The read side. Queries live apart from the write rules so a change to what a row
 * looks like happens in one place instead of being copied into every SELECT.
 */
export const selectMessageColumns =
	"id, conversation_id, author, author_id, body, sent_at, is_outgoing, is_deleted, is_edited, expires_at, is_expired, receipt_rank, is_view_once, quote_sent_at, quote_author_id";

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
				WHERE conversation_id = ?1 AND is_hidden = 0
				ORDER BY sent_at DESC, id DESC
				LIMIT ?2
			 ) ORDER BY sent_at ASC, id ASC`,
		)
		.all(conversationId, limit);
}

/**
 * One page older than a cursor, in reading order.
 *
 * The comparison is on `sent_at` alone because a message's id *is* its conversation and
 * instant — two rows in a thread cannot share one — and it rides the
 * `(conversation_id, sent_at DESC)` index, so walking back through history stays a range
 * scan instead of a sort of the whole conversation.
 */
export function readMessagesBefore(
	db: Database,
	conversationId: ConversationId,
	beforeSentAt: number,
	limit: number,
): MessageRow[] {
	return db
		.query<MessageRow, [string, number, number]>(
			`SELECT * FROM (
				SELECT ${selectMessageColumns}
				FROM messages
				WHERE conversation_id = ?1 AND sent_at < ?2 AND is_hidden = 0
				ORDER BY sent_at DESC
				LIMIT ?3
			 ) ORDER BY sent_at ASC`,
		)
		.all(conversationId, beforeSentAt, limit);
}

export function readAllMessages(db: Database, conversationId: ConversationId): MessageRow[] {
	return db
		.query<MessageRow, [string]>(
			`SELECT ${selectMessageColumns}
			 FROM messages
			 WHERE conversation_id = ?1 AND is_hidden = 0
			 ORDER BY sent_at ASC, id ASC`,
		)
		.all(conversationId);
}

/**
 * Full-text hits, strongest match first. Deleted rows are filtered here as well as in the
 * view: a body the sender deleted must not be discoverable, and `markMessageDeleted` blanks
 * it only for rows this build wrote.
 */
export function searchMessages(db: Database, query: string, limit: number): MessageRow[] {
	const ftsQuery = toFtsQuery(query);
	if (ftsQuery === null || limit <= 0) {
		return [];
	}
	return db
		.query<MessageRow, [string, number]>(
			`SELECT m.id, m.conversation_id, m.author, m.author_id, m.body, m.sent_at, m.is_outgoing, m.is_deleted, m.is_edited, m.expires_at, m.is_expired, m.receipt_rank, m.is_view_once, m.quote_sent_at, m.quote_author_id
			 FROM messages_fts
			 JOIN messages m ON m.rowid = messages_fts.rowid
			 WHERE messages_fts MATCH ?1
			   AND m.is_deleted = 0 AND m.is_hidden = 0
			 ORDER BY bm25(messages_fts), m.sent_at DESC
			 LIMIT ?2`,
		)
		.all(ftsQuery, limit);
}

export { toConversation, toMessage };
