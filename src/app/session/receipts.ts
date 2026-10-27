import type { ConversationId } from "../../domain/types";
import type { SessionContext } from "./types";

/**
 * `sendReceipt` resolves its recipient as a phone number or a UUID, so a group
 * conversation cannot be passed through unchanged. Groups are skipped until the
 * receipt path for them is verified.
 */
export function isDirectConversationId(conversationId: ConversationId): boolean {
	return /^\+?\d{5,}$/.test(conversationId) || /^[0-9a-fA-F-]{32,36}$/.test(conversationId);
}

/**
 * Tells the other side their messages were read, once a human opened the thread.
 *
 * Not a page: marking a thread read clears its state, so anything left out of a page
 * here could never be acknowledged afterwards. That is why this reads the whole thread.
 */
export async function sendReadReceipts(
	context: SessionContext,
	conversationId: ConversationId,
): Promise<void> {
	if (!isDirectConversationId(conversationId)) {
		return;
	}
	try {
		const messages = await context.store.listAllMessages(conversationId);
		const timestamps = messages
			.filter((entry) => !entry.isOutgoing && !entry.isDeleted)
			.map((entry) => entry.sentAt);
		await context.backend.sendReceipt(conversationId, timestamps);
	} catch (error) {
		context.record(error instanceof Error ? `receipt: ${error.message}` : String(error));
	}
}
