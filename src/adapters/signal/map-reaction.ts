import type { ConversationId, EditAuthor } from "../../domain/types";
import type { Target } from "./map-target";
import type { Reaction as ReactionPayload } from "./schemas";

/**
 * A reaction the other side put on a message. It is an event about an existing
 * message, never a message of its own — which is the bug this mapping exists to
 * avoid: a reaction-only data message used to be stored as an empty message row, so
 * every 👍 left a blank line in the thread and bumped the conversation.
 */
export interface MappedReaction {
	readonly conversationId: ConversationId;
	readonly targetSentAt: number;
	/** Who reacted, as a stable id and the label to show. */
	readonly reactor: EditAuthor;
	readonly emoji: string;
	readonly isRemove: boolean;
}

/**
 * One reaction, or null when there is nothing we can apply: an empty emoji is a
 * payload this build does not understand, and guessing would put a marker on a
 * message nobody acknowledged.
 *
 * The target's author (`targetAuthor*`) is deliberately not part of the result: a
 * reaction may address anyone's message, and `sent_at` already identifies one message
 * within its conversation — the same key an edit and a delete use.
 */
export function mapReaction(
	target: Target,
	payload: ReactionPayload,
	reactor: EditAuthor,
): MappedReaction | null {
	// Emoji are multi-codepoint; trim only the padding a client might add.
	const emoji = payload.emoji.trim();
	if (emoji.length === 0) {
		return null;
	}
	return {
		conversationId: target.id,
		targetSentAt: payload.targetSentTimestamp,
		reactor,
		emoji,
		isRemove: payload.isRemove === true,
	};
}
