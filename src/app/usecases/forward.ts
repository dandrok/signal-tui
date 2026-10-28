import { displayName } from "../../domain/format";
import type { Conversation, ConversationId, Message } from "../../domain/types";

/**
 * Forwarding: the words of a message, sent to a second conversation.
 *
 * Signal has no `forward` command and the protocol has no "forwarded" field, so a forward is
 * an ordinary send addressed elsewhere plus the picker that names where. Nothing here touches
 * the wire: the session performs it, and `send` already writes the local echo, because Signal
 * never echoes a send back to the device that wrote it.
 *
 * Text only, and out loud about it. A message with files is refused rather than sent as its
 * caption alone: a forward that silently drops the attachment would look like a complete copy
 * of something it is not.
 */

/**
 * What a confirmed forward does: one of the two refusals, or the send itself.
 *
 * A result rather than a nullable request, because the two ways a forward can fail read
 * differently ("that message has files" is not "no chat is called that") and the wiring has to
 * say which. Building it here keeps the reason, the destination and the body in one function,
 * so the send path cannot disagree with the picker the key opened.
 */
export type ForwardPlan =
	| { readonly kind: "refused"; readonly reason: string }
	| { readonly kind: "send"; readonly to: Conversation; readonly body: string };

/**
 * Why this message cannot be forwarded, in the words the status line will show, or null when
 * it can. One function rather than a predicate plus a message, because the reasons differ —
 * "it has files" and "it was deleted" are not the same refusal and the key has to say which.
 */
export function forwardRefusal(message: Message, conversationId: ConversationId): string | null {
	if (message.conversationId !== conversationId) {
		return "that message is not in this conversation";
	}
	if (message.isDeleted) {
		return "that message was deleted: nothing to forward";
	}
	if (message.isExpired === true) {
		return "that message expired: nothing to forward";
	}
	if (message.isViewOnce === true) {
		// The text was never written to the cache, so there is nothing to copy.
		return "a view-once message was never stored: nothing to forward";
	}
	if ((message.attachments?.length ?? 0) > 0) {
		return "that message has files: forwarding sends text only";
	}
	if (message.body.trim().length === 0) {
		return "that message has no text to forward";
	}
	return null;
}

/** Whether `f` would forward this message — what the status line advertises with. */
export function canForward(message: Message, conversationId: ConversationId): boolean {
	return forwardRefusal(message, conversationId) === null;
}

/**
 * Where a forward can go: every conversation but the thread the message came from.
 *
 * Signal's own client leaves the current chat out of the forward sheet, and so does this:
 * forwarding to where it already is produces a second copy nobody asked for, and the picker
 * has no way to tell the two apart.
 */
export function forwardTargets(
	conversations: readonly Conversation[],
	from: ConversationId | undefined,
): readonly Conversation[] {
	return conversations.filter((conversation) => conversation.id !== from);
}

/** The conversations a filter matches, and which one the picker is on. */
export interface ForwardMatches {
	readonly matches: readonly Conversation[];
	/** Index into `matches`; always 0 when nothing matched. */
	readonly picked: number;
}

/**
 * What the picker shows for a draft.
 *
 * An empty draft is every conversation, in the list's own order (most recent first), so `f`
 * then `⏎` is the two keystrokes it looks like. Typing narrows by name — case-insensitively,
 * because nobody types a display name with their thumbs in a terminal — and `pick` is clamped
 * rather than wrapped: a filter that shrinks under the highlight must not land on a stranger.
 */
export function forwardMatches(
	targets: readonly Conversation[],
	draft: string,
	pick: number,
): ForwardMatches {
	const filter = draft.trim().toLowerCase();
	const matches =
		filter.length === 0
			? targets
			: targets.filter((conversation) => displayName(conversation).toLowerCase().includes(filter));
	const picked = matches.length === 0 ? 0 : Math.min(Math.max(0, pick), matches.length - 1);
	return { matches, picked };
}

/** The conversation a confirmed forward would go to, or undefined when the draft matches none. */
export function forwardTarget(
	targets: readonly Conversation[],
	draft: string,
	pick: number,
): Conversation | undefined {
	const { matches, picked } = forwardMatches(targets, draft, pick);
	return matches[picked];
}

/**
 * What a confirmed forward does: the send, or the sentence that says why there is none.
 *
 * The message is resolved by the caller because a row can be swept between the key and the
 * confirm; everything after that — which refusal, which conversation, which body — is decided
 * here, so the key path and the send path cannot disagree.
 */
export function forwardPlan(
	message: Message | undefined,
	conversationId: ConversationId,
	targets: readonly Conversation[],
	draft: string,
	pick: number,
): ForwardPlan {
	if (message === undefined) {
		return { kind: "refused", reason: "that message is gone: nothing to forward" };
	}
	const refusal = forwardRefusal(message, conversationId);
	if (refusal !== null) {
		return { kind: "refused", reason: refusal };
	}
	const to = forwardTarget(targets, draft, pick);
	if (to === undefined) {
		return { kind: "refused", reason: "no conversation matches that" };
	}
	return { kind: "send", to, body: message.body };
}

/** What the status line says once a forward has gone out. */
export function forwardNotice(to: Conversation): string {
	return `forwarded to ${displayName(to)}`;
}
