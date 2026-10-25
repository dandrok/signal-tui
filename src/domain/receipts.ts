import type { Message, ReceiptState } from "./types";

/**
 * How far one of our own messages has travelled, weakest first.
 *
 * The order is the rule, not decoration: Signal delivers receipts out of band, so
 * a read can arrive before the delivery it implies, and a device that was offline
 * can report delivery long after the other side read the message. A receipt may
 * only ever strengthen what the cache knows.
 */
const LADDER: readonly ReceiptState[] = ["delivered", "read", "viewed"];

/** 1 for delivered, 2 for read, 3 for viewed; 0 stays unused so it reads as "none". */
export function receiptRank(state: ReceiptState): number {
	return LADDER.indexOf(state) + 1;
}

/**
 * The stronger of the two states. `undefined` is "nothing acknowledged yet", which
 * every receipt beats — including a weaker one, so a delivery receipt for an
 * unknown message still records delivery.
 */
export function strongerReceipt(
	current: ReceiptState | undefined,
	incoming: ReceiptState,
): ReceiptState {
	if (current === undefined) {
		return incoming;
	}
	return receiptRank(current) >= receiptRank(incoming) ? current : incoming;
}

/**
 * A stored rank back to its state. Unknown ranks answer `undefined` rather than
 * guessing: a row with no receipt, and a number this build does not recognise,
 * both mean "nothing has been acknowledged".
 */
export function receiptFromRank(rank: number | null): ReceiptState | undefined {
	if (rank === null || rank <= 0) {
		return undefined;
	}
	return LADDER[rank - 1];
}

/**
 * Ticks drawn beside one of our own messages: one once the other side's device has
 * it, two once they have read it. Kept next to the ladder so the state-to-tick
 * mapping exists once — the renderer and any future counter both read this.
 *
 * A viewed receipt only ever arrives for a view-once message, which is also read,
 * so it earns the same two ticks rather than a third symbol nobody can decode.
 */
const TICKS: Record<ReceiptState, string> = {
	delivered: " ✓",
	read: " ✓✓",
	viewed: " ✓✓",
};

/**
 * The tick suffix for a message: empty for incoming messages, for one of ours that
 * nobody has acknowledged, and for a row cached before receipts existed.
 */
export function receiptMarker(message: Message): string {
	if (!message.isOutgoing || message.receipt === undefined) {
		return "";
	}
	return TICKS[message.receipt];
}
