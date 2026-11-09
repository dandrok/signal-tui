import type { Database } from "bun:sqlite";
import type { ConversationId, EditAuthor, MessageId } from "../../domain/types";
import { SELF_AUTHOR_ID } from "../../domain/types";
import { deleteAttachments } from "./attachments";
import { deleteReactions } from "./reactions";

/**
 * The rules that decide when a cached message stops showing its text. They live here rather
 * than inline in the store because each one carries a decision that is easy to lose in a long
 * file: who may replace a body, who may remove a message, and what "gone" means.
 *
 * The author-checking statements end in `RETURNING id` on purpose. The driver's change counter is
 * not portable — one build reports the rows a statement changed, another reports the running
 * total for the connection — and an off-by-five there would rewrite the wrong message or report
 * the wrong purge count. The rows a statement returns mean the same thing everywhere.
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
	// The identity check is the point of this query: a timestamp identifies a message
	// within a conversation, not an author, so without it an edit from one member of a
	// group could rewrite another member's message. Identity means an id — a display label
	// is whatever the sender set it to, so it never authorises a write. The one row that
	// kept no id (cached before schema v4) is ours to edit and nobody else's: `is_outgoing`
	// is not something a peer can produce, and only this app acts as `SELF_AUTHOR_ID`.
	const updated = db
		.query<{ id: string }, [string, number, string | null, number, string]>(
			`UPDATE messages SET body = ?5, is_edited = 1
			 WHERE conversation_id = ?1 AND sent_at = ?2
			   AND is_deleted = 0 AND is_expired = 0 AND is_view_once = 0
			   AND (author_id = ?3 OR (author_id IS NULL AND is_outgoing = 1 AND ?4 = 1))
			 RETURNING id`,
		)
		.all(conversationId, targetSentAt, editor.id, isSelf(editor) ? 1 : 0, body);
	return updated.length > 0;
}

/** Whether this actor is the account itself, whose identity no peer can claim. */
function isSelf(actor: EditAuthor): boolean {
	return actor.id === SELF_AUTHOR_ID;
}

/**
 * Marks a message deleted, when the deleter is its author, and drops what hung off it.
 *
 * The identity check is the point of the statement, for the same reason `applyEditRow` has one:
 * a delete names a message by its instant, and an instant identifies a message within a
 * conversation, not its author. Identity means an id — a display label is peer-controlled, so
 * one member naming themselves after another must not reach that member's row — and a row whose
 * id was never stored is only ours, matched by `is_outgoing` and this app's own actor. An admin's
 * removal of somebody else's message arrives as a separate payload (`adminDelete`), so
 * `remoteDelete` is only ever legitimate from the author.
 *
 * `is_deleted = 0` makes the answer honest: a replay, or a refused delete, reports no change and
 * the session skips the redraw. The files and reactions go **only** when the row actually
 * changed — clearing them for a refused delete would be the damage the guard exists to prevent.
 */
export function applyDeleteRow(
	db: Database,
	conversationId: ConversationId,
	messageId: MessageId,
	deleter: EditAuthor,
): boolean {
	return db.transaction(() => {
		const updated = db
			.query<{ id: string }, [string, string, string | null, number]>(
				`UPDATE messages SET is_deleted = 1, body = ''
				 WHERE id = ?1 AND conversation_id = ?2 AND is_deleted = 0
				   AND (author_id = ?3 OR (author_id IS NULL AND is_outgoing = 1 AND ?4 = 1))
				 RETURNING id`,
			)
			.all(messageId, conversationId, deleter.id, isSelf(deleter) ? 1 : 0);
		if (updated.length === 0) {
			return false;
		}
		// The files on disk are signal-cli's, but the references are ours and a deleted message
		// should not keep pointing at them — nor keep reactions to text that is gone.
		deleteAttachments(db, messageId);
		deleteReactions(db, messageId);
		return true;
	})();
}

/** Rows per statement. Small enough to bound memory, large enough to stay cheap. */
const PURGE_BATCH = 500;

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
