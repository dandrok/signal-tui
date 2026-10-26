import type { Message } from "../../domain/types";

/**
 * How a payload merges into the row the cache already has.
 *
 * Every rule here is about a replay: an envelope arrives again after a reconnect, or in a
 * form that knows less than the row does. The SQLite adapter applies the same rules through
 * `COALESCE` and a body `CASE`, so this file is the readable half of one decision — a rule
 * that only one adapter has is a rule half the app can break.
 */
export function mergeMessage(existing: Message, incoming: Message): Message {
	// An absent `attachments` field means "this update says nothing about files", not "this
	// message has none" — otherwise a partial update silently drops the files the store had.
	const attachments = incoming.attachments ?? existing.attachments;
	// A correction outranks the original text, and deletion is one-way: Signal has no
	// undelete, so a redelivered envelope must not revive a tombstone.
	const deleted = existing.isDeleted === true || incoming.isDeleted === true;
	// Deleted, expired, or corrected: in all three the stored body is the newer truth.
	const frozen =
		existing.isDeleted === true || existing.isExpired === true || existing.isEdited === true;
	// A view-once message keeps no content, ever: not on the first write, not on a replay,
	// and not when an older cache still had the text. One-way, like deletion.
	const viewOnce = existing.isViewOnce === true || incoming.isViewOnce === true;
	// The quote follows the body: a payload that carries none says nothing about the one
	// this row already has (the fifth field to fail this way, after the author id, the
	// receipt, the deadline and the expired flag). A quote is only an identity, so carrying
	// it forward leaks nothing.
	const quote = incoming.quote ?? existing.quote;
	// The stored deadline wins. A replay can supply one where none was known, never replace
	// one: extending it would outlive what the sender promised.
	const expiresAt = existing.expiresAt ?? incoming.expiresAt;
	// A replay that carries no author id says nothing about the sender, not that there is
	// none: dropping the stored one would silently downgrade the row to label matching,
	// which the SQLite adapter avoids with COALESCE.
	const authorId = incoming.authorId ?? existing.authorId;
	// Same shape, and the fourth field to fail this way: a payload never carries a receipt,
	// so spreading it over the row would erase the one the store recorded and the ticks
	// would vanish on a reconnect.
	const receipt = incoming.receipt ?? existing.receipt;

	const merged: Message = {
		...incoming,
		isDeleted: deleted,
		body: viewOnce ? "" : frozen ? existing.body : incoming.body,
		...(quote === undefined ? {} : { quote }),
		...(viewOnce ? { isViewOnce: true } : {}),
		...(existing.isEdited === true ? { isEdited: true } : {}),
		// Same for expiry: the flag lives in the row, not in the payload.
		...(existing.isExpired === true ? { isExpired: true } : {}),
		...(expiresAt === undefined ? {} : { expiresAt }),
		...(authorId === undefined ? {} : { authorId }),
		...(receipt === undefined ? {} : { receipt }),
	};

	// Files go with the text: a tombstone, an expired row and a view-once message keep none.
	const kept = viewOnce || deleted || existing.isExpired === true ? [] : attachments;
	return kept === undefined ? merged : { ...merged, attachments: kept };
}
