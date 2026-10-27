import { isDirectConversationId } from "../../domain/ids";
import type { ConversationId } from "../../domain/types";
import type { SessionContext } from "./types";

/**
 * Groups are skipped: `sendReceipt` resolves its recipient as a phone number or a UUID, so a
 * group conversation cannot be passed through unchanged until that path is verified.
 */

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
