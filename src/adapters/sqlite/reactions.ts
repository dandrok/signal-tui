import type { Database } from "bun:sqlite";
import type { ConversationId, Reaction } from "../../domain/types";

/** Well under SQLite's historical 999-variable ceiling, same as the file lookup. */
export const REACTION_ID_CHUNK = 500;

interface ReactionRow {
	message_id: string;
	author_id: string;
	author: string;
	emoji: string;
}

/**
 * Reactions for a page of messages, in one query per chunk. A reaction belongs to a
 * message by foreign key, so deleting the message drops them without touching this
 * table — the same reason files have their own rows instead of a JSON column.
 */
export function loadReactions(
	db: Database,
	messageIds: readonly string[],
	chunkSize = REACTION_ID_CHUNK,
): Map<string, Reaction[]> {
	const byMessage = new Map<string, Reaction[]>();

	for (let start = 0; start < messageIds.length; start += chunkSize) {
		const chunk = messageIds.slice(start, start + chunkSize);
		const placeholders = chunk.map((_, index) => `?${index + 1}`).join(", ");
		const rows = db
			.query<ReactionRow, string[]>(
				`SELECT message_id, author_id, author, emoji
				 FROM reactions
				 WHERE message_id IN (${placeholders})
				 ORDER BY message_id, emoji`,
			)
			.all(...chunk);

		for (const row of rows) {
			const list = byMessage.get(row.message_id) ?? [];
			list.push({ emoji: row.emoji, author: row.author, authorId: row.author_id });
			byMessage.set(row.message_id, list);
		}
	}
	return byMessage;
}

/**
 * Applies one reaction to a cached message and reports whether anything changed.
 *
 * Three rules, each one a way this goes wrong:
 *  - the message is found by `conversation_id + sent_at` (the identity an edit and a
 *    delete use) and a message that is gone takes no reactions: a deleted or expired
 *    row must not collect markers for text that no longer exists;
 *  - the key is `(message_id, author_id)`, so a second emoji from the same person
 *    replaces the first rather than stacking — that is how Signal clients behave;
 *  - the `DO UPDATE … WHERE emoji <> excluded.emoji` clause makes a repeated reaction
 *    report no change, which is what keeps the UI from redrawing for nothing.
 *
 * `RETURNING` is the answer to "did it change", not the driver's change counter.
 */
export function applyReactionRow(
	db: Database,
	conversationId: ConversationId,
	targetSentAt: number,
	reaction: Reaction,
	isRemove: boolean,
): boolean {
	const message = db
		.query<{ id: string }, [string, number]>(
			`SELECT id FROM messages
			 WHERE conversation_id = ?1 AND sent_at = ?2
			   AND is_deleted = 0 AND is_expired = 0`,
		)
		.get(conversationId, targetSentAt);
	if (message === null) {
		return false;
	}

	if (isRemove) {
		const removed = db
			.query<{ author_id: string }, [string, string]>(
				`DELETE FROM reactions WHERE message_id = ?1 AND author_id = ?2 RETURNING author_id`,
			)
			.all(message.id, reaction.authorId);
		return removed.length > 0;
	}

	const written = db
		.query<{ author_id: string }, [string, string, string, string]>(
			`INSERT INTO reactions (message_id, author_id, author, emoji)
			 VALUES (?1, ?2, ?3, ?4)
			 ON CONFLICT(message_id, author_id) DO UPDATE SET
			 	author = excluded.author,
			 	emoji = excluded.emoji
			 WHERE reactions.emoji <> excluded.emoji
			 RETURNING author_id`,
		)
		.all(message.id, reaction.authorId, reaction.author, reaction.emoji);
	return written.length > 0;
}

/** A message that is gone keeps no reactions. */
export function deleteReactions(db: Database, messageId: string): void {
	db.query<null, [string]>("DELETE FROM reactions WHERE message_id = ?1").run(messageId);
}
