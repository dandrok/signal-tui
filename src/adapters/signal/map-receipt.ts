import type { ReceiptState } from "../../domain/types";
import type { ReceiptMessage } from "./schemas";

/**
 * A receipt the other side sent for messages we wrote. It names them by the
 * timestamps it acknowledges and says how far they got — never by conversation:
 * `JsonReceiptMessage` carries no group id, so a receipt cannot say which thread a
 * group message belongs to, and the timestamp is how Signal identifies a message
 * everywhere else too (an edit and a delete-for-everyone both address one that way).
 */
export interface MappedReceipt {
	readonly timestamps: readonly number[];
	readonly state: ReceiptState;
}

/**
 * How far the acknowledged messages got. Upstream the three flags are one enum
 * (`Receipt.Type`), so exactly one is true; a payload where none is true is a kind
 * this build does not understand, and guessing would put a tick on a message nobody
 * confirmed.
 */
function stateOf(receipt: ReceiptMessage): ReceiptState | null {
	if (receipt.isViewed === true) {
		return "viewed";
	}
	if (receipt.isRead === true) {
		return "read";
	}
	return receipt.isDelivery === true ? "delivered" : null;
}

/**
 * A receipt for no message is nothing to apply — an empty acknowledgement would
 * match no row — so it maps to null rather than to an event full of noise.
 */
export function mapReceipt(receipt: ReceiptMessage): MappedReceipt | null {
	const state = stateOf(receipt);
	const timestamps = receipt.timestamps ?? [];
	if (state === null || timestamps.length === 0) {
		return null;
	}
	return { timestamps, state };
}
