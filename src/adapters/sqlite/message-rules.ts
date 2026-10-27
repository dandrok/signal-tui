import type { Database } from "bun:sqlite";
import { receiptRank } from "../../domain/receipts";
import type { ConversationId, EditAuthor, MessageId, ReceiptState } from "../../domain/types";

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
			   AND is_deleted = 0 AND is_expired = 0 AND is_view_once = 0
			   AND (author_id = ?3 OR (author_id IS NULL AND author = ?4))
			 RETURNING id`,
		)
		.all(conversationId, targetSentAt, editor.id, editor.label, body);
	return updated.length > 0;
}

/** Rows per statement. Small enough to bound memory, large enough to stay cheap. */
const PURGE_BATCH = 500;

/** Timestamps per statement: one bind parameter each, so well under the 999 ceiling. */
const RECEIPT_CHUNK = 500;

/**
 * Records a receipt for messages we sent and reports the conversations it moved.
 *
 * Three rules, and each one is a way this goes wrong if it is left out:
 *
 *  - `is_outgoing = 1`: a receipt acknowledges something we wrote. Without it a peer
 *    could mark its own message as read by us by echoing our cache's timestamps back.
 *  - `receipt_rank < ?1`: receipts arrive out of order, so this is the direction rule,
 *    not an optimisation. A delivery that lands after a read must leave the read
 *    alone, or the tick on screen goes backwards.
 *  - `RETURNING conversation_id`: the driver's change counter is not portable and
 *    would also be wrong to report here — a receipt for five messages in one thread
 *    should name that thread once.
 *
 * The timestamps are chunked because a receipt can name a whole conversation, and
 * one bind parameter per timestamp hits SQLite's variable ceiling on older builds.
 */
export function applyReceiptRows(
	db: Database,
	timestamps: readonly number[],
	state: ReceiptState,
	chunkSize = RECEIPT_CHUNK,
): ConversationId[] {
	const rank = receiptRank(state);
	const changed = new Set<ConversationId>();

	db.transaction(() => {
		for (let start = 0; start < timestamps.length; start += chunkSize) {
			const chunk = timestamps.slice(start, start + chunkSize);
			const placeholders = chunk.map((_, index) => `?${index + 2}`).join(", ");
			const rows = db
				.query<{ conversation_id: string }, [number, ...number[]]>(
					`UPDATE messages SET receipt_rank = ?1
					 WHERE is_outgoing = 1 AND receipt_rank < ?1
					   AND sent_at IN (${placeholders})
					 RETURNING conversation_id`,
				)
				.all(rank, ...chunk);
			for (const row of rows) {
				changed.add(row.conversation_id);
			}
		}
	})();

	return [...changed];
}

export function purgeExpiredRows(db: Database, now: number, batch = PURGE_BATCH): number {
	// One transaction for the whole sweep, but each statement handles at most `batch`
	// rows. A backlog that built up while the app was closed can be tens of thousands
	// of messages, and both `RETURNING` (buffered by SQLite) and `.all()` (an array)
	// hold everything a statement produces — `iterate()` does not change that.
	const due = `SELECT rowid FROM messages
	              WHERE expires_at IS NOT NULL AND expires_at <= ?1 AND is_expired = 0
	              ORDER BY expires_at
	              LIMIT ?2`;

	return db.transaction(() => {
		let purged = 0;
		for (;;) {
			// Same subquery for every statement, so a batch's files and reactions go with
			// its text instead of outliving it.
			db.query<null, [number, number]>(
				`DELETE FROM reactions
				  WHERE message_id IN (SELECT id FROM messages WHERE rowid IN (${due}))`,
			).run(now, batch);
			db.query<null, [number, number]>(
				`DELETE FROM attachments
				  WHERE message_id IN (SELECT id FROM messages WHERE rowid IN (${due}))`,
			).run(now, batch);

			const updated = db
				.query<{ id: string }, [number, number]>(
					`UPDATE messages SET body = '', is_expired = 1
					 WHERE rowid IN (${due})
					 RETURNING id`,
				)
				.all(now, batch);

			purged += updated.length;
			// A short page means the backlog is done.
			if (updated.length < batch) {
				return purged;
			}
		}
	})();
}

/**
 * Hides a message from this cache's reads, leaving the row where it is.
 *
 * `RETURNING id` for the same reason the other rules use it: the answer is "did a visible row
 * change", and only the statement knows that. Hiding an already-hidden row reports no change,
 * which is what stops `D` pressed twice from redrawing the pane.
 */
export function hideMessageRow(
	db: Database,
	conversationId: ConversationId,
	messageId: MessageId,
): boolean {
	const updated = db
		.query<{ id: string }, [string, string]>(
			`UPDATE messages SET is_hidden = 1
			 WHERE id = ?1 AND conversation_id = ?2 AND is_hidden = 0
			 RETURNING id`,
		)
		.all(messageId, conversationId);
	return updated.length > 0;
}
