import type { ConversationId, MessageId } from "../../domain/types";
import type { SessionContext } from "./types";

/**
 * Hides a message in this cache only.
 *
 * Nothing goes on the wire: the other side keeps the message, and this device stops drawing
 * it — the local equivalent of a chat client's "delete for me". The row stays in the table so
 * a later replay of the same envelope cannot resurrect it as new; the read paths filter it.
 */
export async function hideMessage(
	context: SessionContext,
	conversationId: ConversationId,
	messageId: MessageId,
): Promise<void> {
	const written = context.enqueue(async () => {
		const changed = await context.store.hideMessage(conversationId, messageId);
		if (changed) {
			context.notify();
		}
	});

	await written;
}
