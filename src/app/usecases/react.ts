import { authorIdOf } from "../../domain/message-author";
import { reactionEmojiOf } from "../../domain/reactions";
import type { ConversationId, Message, MessageId } from "../../domain/types";
import type { ReactionTarget } from "../../ports/backend";

/**
 * Reacting to a message: whether it is allowed, what goes on the wire, and nothing else.
 *
 * This is the shape every use case in this folder takes — a pure eligibility predicate, a
 * request builder, and no IO. The session performs the request, the store keeps the echo,
 * and the keymap only decides that `x` starts one.
 */

/** A reaction as the transport needs it. */
export interface ReactionRequest {
	readonly target: ReactionTarget;
	readonly emoji: string;
}

/**
 * Whether a row can take a reaction.
 *
 * A delete-for-everyone and an expired timer both keep the row and blank its text, and the
 * store refuses reactions on both — so the key refuses them too, rather than opening a
 * prompt whose result the cache would drop. A view-once message *can* be reacted to: the
 * row exists, and reacting says nothing about words that were deliberately not kept.
 */
export function canReactTo(message: Message, conversationId: ConversationId): boolean {
	return (
		!message.isDeleted && message.isExpired !== true && authorIdOf(message, conversationId) !== null
	);
}

/**
 * What a prompt would send, or null when it would send nothing.
 *
 * The emoji is validated through the same grapheme rules the pane draws with, so a pasted
 * paragraph or a second emoji cannot become a reaction the other side renders as a wall of
 * text; `null` means "not a reaction", and the caller says so instead of sending.
 */
export function reactionFor(
	message: Message | undefined,
	conversationId: ConversationId,
	emojiInput: string,
): ReactionRequest | null {
	if (message === undefined || !canReactTo(message, conversationId)) {
		return null;
	}
	const authorId = authorIdOf(message, conversationId);
	if (authorId === null) {
		return null;
	}
	const emoji = reactionEmojiOf(emojiInput);
	if (emoji === null) {
		return null;
	}
	return { target: { sentAt: message.sentAt, authorId }, emoji };
}

/** The message a prompt is pointing at, from the thread the pane holds. */
export function targetedMessage(
	messages: readonly Message[],
	targetId: MessageId | null,
): Message | undefined {
	if (targetId === null) {
		return undefined;
	}
	return messages.find((message) => message.id === targetId);
}
