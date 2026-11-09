import { strongerReceipt } from "../../domain/receipts";
import type { ConversationId, Message, ReceiptState } from "../../domain/types";

/**
 * A receipt acknowledges what we sent, and may only strengthen what is stored.
 *
 * Same rules as the SQLite adapter, because this store is what demo mode and half the tests
 * run against: a receipt may only touch our own messages, and a delivery arriving after a read
 * must leave the read alone.
 */
export function receiptIn(
	messages: readonly Message[],
	timestamps: readonly number[],
	state: ReceiptState,
): { readonly messages: readonly Message[]; readonly changed: readonly ConversationId[] } {
	const wanted = new Set(timestamps);
	const changed = new Set<ConversationId>();
	const next = messages.map((message) => {
		if (!message.isOutgoing || !wanted.has(message.sentAt)) {
			return message;
		}
		const receipt = strongerReceipt(message.receipt, state);
		if (receipt === message.receipt) {
			return message;
		}
		changed.add(message.conversationId);
		return { ...message, receipt };
	});
	return { messages: next, changed: [...changed] };
}
