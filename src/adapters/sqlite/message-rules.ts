import type { Database } from "bun:sqlite";
import type { ConversationId, EditAuthor } from "../../domain/types";

/**
 * The two rules that decide when a cached message stops showing its text. Both live
 * here rather than inline in the store because each one carries a decision that is
 * easy to lose in a long file: who may replace a body, and what "gone" means.
 *
 * Both statements end in `RETURNING id` on purpose. The driver's change counter is
 * not portable — one build reports the rows a statement changed, another reports the
 * running total for the connection — and an off-by-five there would rewrite the wrong
 * message or report the wrong purge count. The rows a statement returns mean the same
 * thing everywhere.
 */
export function applyEditRow(
	db: Database,
	conversationId: ConversationId,
	targetSentAt: number,
	editor: EditAuthor,
	body: string,
): boolean {
	// The FTS triggers on `messages` re-index the new body, so search follows the
	// edit without a second write. A deleted message keeps its blank body.
	//
	// The author check is the point of this query: a timestamp identifies a message
	// within a conversation, not an author, so without it an edit from one member
	// of a group could rewrite another member's message. Rows cached before schema
	// v4 have no author_id and are matched on the label they were stored with.
	const updated = db
		.query<{ id: string }, [string, number, string | null, string, string]>(
			`UPDATE messages SET body = ?5, is_edited = 1
			 WHERE conversation_id = ?1 AND sent_at = ?2
			   AND is_deleted = 0 AND is_expired = 0
			   AND (author_id = ?3 OR (author_id IS NULL AND author = ?4))
			 RETURNING id`,
		)
		.all(conversationId, targetSentAt, editor.id, editor.label, body);
	return updated.length > 0;
}

export function purgeExpiredRows(db: Database, now: number): number {
	// One transaction: the files go with the text, or a reader could still open a
	// message that was supposed to be gone. The FTS triggers on `messages` reindex
	// the emptied body, so search forgets it at the same time.
	return db.transaction(() => {
		db.query<null, [number]>(
			`DELETE FROM attachments WHERE message_id IN (
			   SELECT id FROM messages
			    WHERE expires_at IS NOT NULL AND expires_at <= ?1 AND is_expired = 0
			 )`,
		).run(now);

		const purged = db
			.query<{ id: string }, [number]>(
				`UPDATE messages SET body = '', is_expired = 1
				 WHERE expires_at IS NOT NULL AND expires_at <= ?1 AND is_expired = 0
				 RETURNING id`,
			)
			.all(now);
		return purged.length;
	})();
}
