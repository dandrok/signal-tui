import type { Database } from "bun:sqlite";
import type { Conversation, ConversationId } from "../../domain/types";

/**
 * The conversation half of the SQLite adapter, as four statements.
 *
 * Every rule here has a twin in `memory/conversations.ts`, and they are meant to be read side
 * by side: nothing is trusted to the driver's defaults, so "an empty name does not erase a
 * known one" is spelled out in SQL and in JavaScript rather than assumed.
 */

export function upsertConversation(db: Database, conversation: Conversation): void {
	db.query<null, [string, string, number, number, number | null]>(
		// A payload that carries no timer says nothing about the timer, so the stored one
		// survives: COALESCE, not a default of zero.
		`INSERT INTO conversations (id, name, unread_count, last_activity_at, expires_in_seconds)
		 VALUES (?1, ?2, ?3, ?4, ?5)
		 ON CONFLICT(id) DO UPDATE SET
			name = CASE WHEN TRIM(excluded.name) = '' THEN conversations.name ELSE excluded.name END,
			last_activity_at = MAX(conversations.last_activity_at, excluded.last_activity_at),
			expires_in_seconds = COALESCE(excluded.expires_in_seconds, conversations.expires_in_seconds)`,
	).run(
		conversation.id,
		conversation.name,
		conversation.unreadCount,
		conversation.lastActivityAt,
		conversation.expiresInSeconds ?? null,
	);
}

export function readExpiresInSeconds(
	db: Database,
	conversationId: ConversationId,
): number | undefined {
	const row = db
		.query<{ expires_in_seconds: number | null }, [string]>(
			"SELECT expires_in_seconds FROM conversations WHERE id = ?1",
		)
		.get(conversationId);
	return row?.expires_in_seconds ?? undefined;
}

export function addUnread(db: Database, conversationId: ConversationId, by: number): void {
	db.query<null, [number, string]>(
		"UPDATE conversations SET unread_count = unread_count + ?1 WHERE id = ?2",
	).run(by, conversationId);
}

export function clearUnread(db: Database, conversationId: ConversationId): boolean {
	// The guard makes the result meaningful: an already-read conversation reports no change,
	// which is what stops the UI feedback loop. RETURNING states that exactly, without leaning
	// on the driver's change counter.
	const updated = db
		.query<{ id: string }, [string]>(
			`UPDATE conversations SET unread_count = 0
			 WHERE id = ?1 AND unread_count > 0
			 RETURNING id`,
		)
		.all(conversationId);
	return updated.length > 0;
}
