import { SELF_LABEL } from "../../domain/format";
import type { MessageRef } from "../../domain/message-ref";
import type { ConversationId } from "../../domain/types";
import { SELF_AUTHOR_ID } from "../../domain/types";
import type { SessionContext } from "./types";

/**
 * Sends an edit and applies the local echo.
 *
 * Signal does not echo a send back to the device that wrote it, so without the echo a
 * correction would leave this screen showing the old body until something else re-read the
 * thread. The echo goes through the same `applyEdit` the incoming path uses, under
 * `SELF_AUTHOR_ID` — which is what makes the row read `· edited` immediately.
 */
export async function sendEdit(
	context: SessionContext,
	conversationId: ConversationId,
	target: MessageRef,
	body: string,
): Promise<void> {
	await context.backend.sendEdit(conversationId, target, body);

	const written = context.enqueue(async () => {
		const applied = await context.store.applyEdit(
			conversationId,
			target.sentAt,
			{ id: SELF_AUTHOR_ID, label: SELF_LABEL },
			body,
		);
		// A row the cache does not hold (or one that expired in the meantime) takes no
		// edit: nothing changed, so nothing redraws.
		if (applied) {
			context.notify();
		}
	});

	await written;
}
