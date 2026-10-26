import type { ConversationId, Message, MessageId } from "../domain/types";
import { SELF_AUTHOR_ID } from "../domain/types";
import { isDirectConversationId } from "./session";

/**
 * Which message a reply would answer, and whether it can be answered at all.
 *
 * Nothing here takes the whole app state: a caller that has the thread and an offset can
 * ask the same questions, and the reducer, the pane and the tests then agree by
 * construction rather than by copying rules.
 */

/** What a submitted draft sends as a reply. */
export interface ReplyTargetIn {
	readonly sentAt: number;
	readonly authorId: string;
	readonly text: string;
}

/**
 * The message a pane is pointing at.
 *
 * There is no separate cursor: the scroll offset already names a message — the bottom-most
 * one in the window — so `j`/`k` keep meaning what they meant, and a selection can never
 * point at a row that is not on screen.
 */
export function pointedMessageIn(
	messages: readonly Message[],
	scroll: number,
): Message | undefined {
	if (messages.length === 0) {
		return undefined;
	}
	const offset = Math.min(Math.max(0, scroll), messages.length - 1);
	return messages[messages.length - 1 - offset];
}

/**
 * The author a reply has to name, or null when it cannot be resolved.
 *
 * `send` refuses a quote without a `quoteAuthor`, and that must be a number or a uuid, so a
 * row whose id we never learned cannot be answered. Two fallbacks keep the common cases
 * alive: our own message is always us, and in a direct chat the conversation *is* the peer —
 * which covers rows cached before schema v4, when author ids were not stored at all. In a
 * group there is nothing to fall back to, because a name is not an identifier.
 */
export function quotedAuthor(message: Message, conversationId: ConversationId): string | null {
	if (message.authorId !== undefined) {
		return message.authorId;
	}
	if (message.isOutgoing) {
		return SELF_AUTHOR_ID;
	}
	return isDirectConversationId(conversationId) ? conversationId : null;
}

/**
 * Whether a message can be answered: a delete-for-everyone, an expired row and a view-once
 * message have nothing to quote, and the author must be resolvable.
 */
export function canAnswerIn(message: Message, conversationId: ConversationId): boolean {
	return (
		!message.isDeleted &&
		message.isExpired !== true &&
		message.isViewOnce !== true &&
		quotedAuthor(message, conversationId) !== null
	);
}

/**
 * What a submitted draft would send as its reply, or null when it would not send one.
 *
 * The text travels with the target because recipients render the quoted block from the
 * payload; this cache keeps only the identity, so the words are read from the message at
 * send time rather than stored a second time.
 */
export function replyTargetIn(
	messages: readonly Message[],
	replyToId: MessageId | null,
	conversationId: ConversationId,
): ReplyTargetIn | null {
	if (replyToId === null) {
		return null;
	}
	const target = messages.find((message) => message.id === replyToId);
	if (target === undefined || !canAnswerIn(target, conversationId)) {
		return null;
	}
	const authorId = quotedAuthor(target, conversationId);
	if (authorId === null) {
		return null;
	}
	return { sentAt: target.sentAt, authorId, text: target.body };
}

/** The message a draft is answering, for the composer to draw. */
export function messageBeingAnsweredIn(
	messages: readonly Message[],
	replyToId: MessageId | null,
): Message | undefined {
	if (replyToId === null) {
		return undefined;
	}
	return messages.find((message) => message.id === replyToId);
}
