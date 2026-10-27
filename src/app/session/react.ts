import { SELF_LABEL } from "../../domain/format";
import type { MessageRef } from "../../domain/message-ref";
import type { ConversationId } from "../../domain/types";
import { SELF_AUTHOR_ID } from "../../domain/types";
import type { SessionContext } from "./types";

/**
 * Sends a reaction and keeps the local echo.
 *
 * Signal never echoes a send back to the device that wrote it, so without the echo our own
 * reaction would not appear until something else re-read the thread. The store applies it
 * under `SELF_AUTHOR_ID` — the same marker our own messages carry — which is what lets a
 * second press replace it instead of adding a twin.
 */
export async function sendReaction(
	context: SessionContext,
	conversationId: ConversationId,
	target: MessageRef,
	emoji: string,
	isRemove = false,
): Promise<void> {
	await context.backend.sendReaction(conversationId, target, emoji, isRemove);

	const written = context.enqueue(async () => {
		const stored = await context.store.applyReaction(
			conversationId,
			target.sentAt,
			{ emoji, author: SELF_LABEL, authorId: SELF_AUTHOR_ID },
			isRemove,
		);
		// A message the cache does not have takes no reaction; nothing changed, so nothing
		// redraws — the same rule the incoming path follows.
		if (stored) {
			context.notify();
		}
	});

	await written;
}
