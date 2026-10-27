import type { MessageRef } from "../../domain/message-ref";
import type { ConversationId } from "../../domain/types";
import type { SessionContext } from "./types";

/**
 * Deletes a message for everyone, and applies the same change locally.
 *
 * The local half is not an optimisation: the other side's devices see a `remoteDelete`
 * envelope, ours does not — Signal never echoes a send back to the device that wrote it — so
 * a client that only sent the envelope would keep showing the message it just removed.
 */
export async function removeMessage(
	context: SessionContext,
	conversationId: ConversationId,
	target: MessageRef,
): Promise<void> {
	await context.backend.deleteForEveryone(conversationId, target);

	const written = context.enqueue(async () => {
		await context.store.markMessageDeleted(conversationId, `${conversationId}:${target.sentAt}`);
		context.notify();
	});

	await written;
}
