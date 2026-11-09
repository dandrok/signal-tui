import type { Database } from "bun:sqlite";
import { receiptRank } from "../../domain/receipts";
import type { ConversationId, ReceiptState } from "../../domain/types";

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
