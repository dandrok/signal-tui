import type { MessageRef } from "../../domain/message-ref";
import type { ConversationId, Message } from "../../domain/types";
import { SELF_AUTHOR_ID } from "../../domain/types";

/**
 * Editing a message: who may, and what goes on the wire.
 *
 * Only our own message, only while it still has words: a deleted, expired or view-once row is
 * exactly the state the cache refuses to refill, and offering to edit it would promise
 * something the store drops on the floor.
 */

export interface EditRequest {
	readonly target: MessageRef;
	readonly body: string;
}

/** Our own message, still ours to change. */
export function canEdit(message: Message, conversationId: ConversationId): boolean {
	return (
		// Ownership is the marker, not `isOutgoing`: `SELF_AUTHOR_ID` is not a number or
		// a uuid, so no peer can write a row that carries it.
		message.authorId === SELF_AUTHOR_ID &&
		!message.isDeleted &&
		message.isExpired !== true &&
		message.isViewOnce !== true &&
		message.conversationId === conversationId
	);
}

/**
 * What an edit would send, or null when it would send nothing.
 *
 * `null` covers three different refusals — not ours, gone, or unchanged — because the caller's
 * next move is the same for all of them: close the prompt, and say why only when words were
 * actually thrown away. An unchanged body is not a failure: it is the user pressing enter
 * without typing, and sending it would rewrite the row for nothing.
 */
export function editFor(
	message: Message | undefined,
	conversationId: ConversationId,
	text: string,
): EditRequest | null {
	if (message === undefined || !canEdit(message, conversationId)) {
		return null;
	}
	const body = text.trim();
	if (body.length === 0 || body === message.body) {
		return null;
	}
	return {
		target: { sentAt: message.sentAt, authorId: SELF_AUTHOR_ID },
		body,
	};
}
