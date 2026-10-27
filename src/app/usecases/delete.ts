import type { MessageRef } from "../../domain/message-ref";
import type { ConversationId, Message } from "../../domain/types";
import { SELF_AUTHOR_ID } from "../../domain/types";

/**
 * Deleting a message for everyone.
 *
 * Only ours, and only while it is still there: a delete names a message by its timestamp, and
 * re-deleting a row the other side already removed sends a pointless envelope that some clients
 * surface as an error.
 */

/** Our own message, still standing. */
export function canDelete(message: Message, conversationId: ConversationId): boolean {
	return (
		// Ownership is the marker, not `isOutgoing`: `SELF_AUTHOR_ID` is not a number or
		// a uuid, so no peer can write a row that carries it.
		message.authorId === SELF_AUTHOR_ID &&
		!message.isDeleted &&
		message.isExpired !== true &&
		message.conversationId === conversationId
	);
}

/** What goes on the wire: the identity of the message to remove. */
export function deleteFor(
	message: Message | undefined,
	conversationId: ConversationId,
): MessageRef | null {
	if (message === undefined || !canDelete(message, conversationId)) {
		return null;
	}
	return { sentAt: message.sentAt, authorId: SELF_AUTHOR_ID };
}
