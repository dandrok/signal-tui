import type { ConversationId } from "../../domain/types";
import { sendReadReceipts } from "./receipts";
import type { SessionContext } from "./types";

/**
 * Clears a thread's unread count, then acknowledges it to the other side.
 *
 * Queued so it runs after any pending increment: opening a conversation while a message
 * lands must end at zero, not one. The redraw happens only on a real change, otherwise
 * listeners would re-run this forever.
 */
export async function markReadConversation(
	context: SessionContext,
	conversationId: ConversationId,
): Promise<void> {
	let changed = false;
	await context.enqueue(async () => {
		changed = await context.store.markConversationRead(conversationId);
	});

	if (!changed) {
		return;
	}
	context.notify();

	// Tell the other side we actually read them, now that a human opened the
	// conversation — not when the message merely arrived.
	await sendReadReceipts(context, conversationId);
}
