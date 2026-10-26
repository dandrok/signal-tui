import type { Database } from "bun:sqlite";
import type { Message } from "../../domain/types";
import { deleteAttachments, replaceAttachments } from "./attachments";

/**
 * Write one message, its attachments and its quote, leaving anything a redelivery did not
 * carry intact.
 *
 * Out of the store class because it is a third of the file and the only place that owns the
 * conflict rules; `inserted` is what tells the session a message was genuinely new, so the
 * rules have to be readable in one place.
 */
export function saveMessageRow(db: Database, message: Message): { readonly inserted: boolean } {
	type SaveParams = [
		string,
		string,
		string,
		string | null,
		string,
		number,
		number,
		number,
		number | null,
		number,
		number | null,
		string | null,
	];
	const params: SaveParams = [
		message.id,
		message.conversationId,
		message.author,
		message.authorId ?? null,
		// A view-once message never keeps its text, whatever the caller handed over:
		// the rule belongs where the bytes land, not only in the mapper.
		message.isViewOnce === true ? "" : message.body,
		message.sentAt,
		message.isOutgoing ? 1 : 0,
		message.isDeleted ? 1 : 0,
		message.expiresAt ?? null,
		message.isViewOnce === true ? 1 : 0,
		// The quote is an identity, not a copy: nothing of the quoted text is written
		// here, so there is nothing for the delete or expiry rules to chase.
		message.quote?.sentAt ?? null,
		message.quote?.authorId ?? null,
	];

	// One write on the common path: a message seen once is inserted, and only a
	// replay or an edit falls through to the update. The transaction keeps the
	// message and its attachment rows from ever disagreeing.
	const inserted = db.transaction(() => {
		// `ON CONFLICT DO NOTHING RETURNING id` answers "was it inserted" exactly: a
		// conflict returns no row, an insert returns one. A change counter would make
		// an existing message look new on some builds, which skips the update below
		// and loses whatever the replay was carrying.
		const insertedRows = db
			.query<{ id: string }, SaveParams>(
				`INSERT INTO messages (id, conversation_id, author, author_id, body, sent_at, is_outgoing, is_deleted, is_edited, expires_at, is_view_once, quote_sent_at, quote_author_id)
				 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0, ?9, ?10, ?11, ?12)
				 ON CONFLICT(id) DO NOTHING
				 RETURNING id`,
			)
			.all(...params);
		const changes = insertedRows.length;

		if (changes === 0) {
			db.query<null, SaveParams>(
				// One rule with three faces: once a message is gone or corrected,
				// a redelivered envelope must not put the old text back. Deletion
				// (Signal has no undelete), expiry (the timer already ran), and an
				// edit (a correction outranks the original) all freeze the body.
				`UPDATE messages SET author = ?3,
					        author_id = COALESCE(?4, author_id),
					        body = CASE
					                 WHEN is_deleted = 1 THEN body
					                 WHEN is_expired = 1 THEN body
					                 WHEN is_edited = 1 THEN body
					                 ELSE ?5
					               END,
					        sent_at = ?6, is_outgoing = ?7,
					        is_deleted = is_deleted | ?8,
					        -- One-way like deletion: a view-once message stays marked, and the
					        -- rows cached by an older release that did keep the text are
					        -- scrubbed by the body branch above on the replay that names it.
					        is_view_once = is_view_once | ?10,
				        -- The deadline is the promise made when the message was stored.
				        -- A replay may supply one where none was known (NULL), and may
				        -- never push out one that exists: that would extend the lifetime
				        -- of a message the sender already expected to be gone.
				        expires_at = COALESCE(expires_at, ?9),
				        -- A quote names an earlier message, so a payload that carries none
				        -- says nothing about it: COALESCE keeps the one already stored.
				        -- Nothing of the quoted text is kept either way, so a replay cannot
				        -- restore words that a delete or a timer took away.
				        quote_sent_at = COALESCE(quote_sent_at, ?11),
				        quote_author_id = COALESCE(quote_author_id, ?12)
					WHERE id = ?1 AND conversation_id = ?2`,
			).run(...params);
		}

		// Files follow the same rule: a tombstone keeps none, whether it was deleted or
		// expired, or a replay would put the rows back on a message that is gone.
		const row = db
			.query<{ is_deleted: number; is_expired: number; is_view_once: number }, [string]>(
				"SELECT is_deleted, is_expired, is_view_once FROM messages WHERE id = ?1",
			)
			.get(message.id);
		if (row !== null && row.is_view_once === 1) {
			// A view-once message keeps no file rows at all: the sender asked for the
			// content to be seen once, and this cache never held it.
			deleteAttachments(db, message.id);
		} else if (row === null || (row.is_deleted !== 1 && row.is_expired !== 1)) {
			replaceAttachments(db, message);
		}
		return changes;
	})();

	return { inserted: inserted > 0 };
}
