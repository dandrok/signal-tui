import type { MessageRef } from "../../domain/message-ref";
import type { ConversationId } from "../../domain/types";
import { SELF_AUTHOR_ID } from "../../domain/types";
import type { ReceiptType, ReplyTarget } from "../../ports/backend";

/**
 * What goes on the wire, as pure functions.
 *
 * `signal-cli`'s JSON-RPC params are the camelCase of its argparse dests, and each command
 * takes its own mix of recipient options — a group is addressed by `groupId` once the
 * session has seen it, a direct chat by `recipient`. Keeping the shapes here means the
 * adapter's methods are one call each, and a payload change is a diff in a file with no
 * socket in it.
 */

/** How a conversation is addressed: the only difference between a group and a chat. */
export interface Address {
	readonly groupId?: ConversationId;
	readonly recipient?: readonly ConversationId[];
}

export function addressFor(conversationId: ConversationId, isGroup: boolean): Address {
	return isGroup ? { groupId: conversationId } : { recipient: [conversationId] };
}

export interface SendParamsInput {
	readonly conversationId: ConversationId;
	readonly body: string;
	readonly isGroup: boolean;
	/** The account we act as; the engine resolves it back to us as the quote's author. */
	readonly account: string;
	readonly replyTo?: ReplyTarget | undefined;
}

/**
 * `send` params. A quote names its target by timestamp *and* author, and the engine rejects
 * the first without the second. Our own messages carry `SELF_AUTHOR_ID`, which is not a
 * number or a uuid, so the account number stands in for it.
 */
export function sendParams(input: SendParamsInput): Record<string, unknown> {
	const address = addressFor(input.conversationId, input.isGroup);
	if (input.replyTo === undefined) {
		return { ...address, message: input.body };
	}
	return {
		...address,
		message: input.body,
		quoteTimestamp: input.replyTo.sentAt,
		quoteAuthor: input.replyTo.authorId === SELF_AUTHOR_ID ? input.account : input.replyTo.authorId,
		quoteMessage: input.replyTo.text,
	};
}

/** `sendReceipt` params: one or more target timestamps, and the kind of receipt. */
export function receiptParams(
	recipient: ConversationId,
	timestamps: readonly number[],
	type: ReceiptType,
): Record<string, unknown> {
	return { recipient, targetTimestamp: [...timestamps], type };
}

export interface ReactionParamsInput {
	readonly conversationId: ConversationId;
	readonly target: MessageRef;
	readonly emoji: string;
	readonly isRemove: boolean;
	readonly isGroup: boolean;
	readonly account: string;
}

/**
 * `sendReaction` params (`SendReactionCommand`): the emoji, the message it names by
 * timestamp and author, and the same recipient options as `send`.
 *
 * `remove` is only present when true — the flag is `storeTrue` upstream, so `false` is not
 * part of the payload's shape.
 */
export function reactionParams(input: ReactionParamsInput): Record<string, unknown> {
	return {
		...addressFor(input.conversationId, input.isGroup),
		emoji: input.emoji,
		targetAuthor: input.target.authorId === SELF_AUTHOR_ID ? input.account : input.target.authorId,
		targetTimestamp: input.target.sentAt,
		...(input.isRemove ? { remove: true } : {}),
	};
}

export interface EditParamsInput {
	readonly conversationId: ConversationId;
	readonly target: MessageRef;
	readonly body: string;
	readonly isGroup: boolean;
}

/**
 * `send` params for an edit: the replacement text travels as `message`, and `editTimestamp`
 * names the message being corrected.
 *
 * Verified against `SendCommand.java` at signal-cli v0.14.9 — `--edit-timestamp` routes to
 * `sendEditMessage(message, recipients, editTimestamp)`, so an edit is an ordinary send with
 * one extra field rather than a command of its own. No quote: an edit replaces the body and
 * keeps whatever the original quoted.
 */
export function editParams(input: EditParamsInput): Record<string, unknown> {
	return {
		...addressFor(input.conversationId, input.isGroup),
		message: input.body,
		editTimestamp: input.target.sentAt,
	};
}

/**
 * `remoteDelete` params: the message to remove, addressed like any other send.
 *
 * Verified against `RemoteDeleteCommand.java` at signal-cli v0.14.9 — the method name is
 * `remoteDelete`, not `send`, and its only required argument is `--target-timestamp`. Unlike
 * an edit it carries no body: the removal *is* the message.
 */
export function deleteParams(
	conversationId: ConversationId,
	target: MessageRef,
	isGroup: boolean,
): Record<string, unknown> {
	return { ...addressFor(conversationId, isGroup), targetTimestamp: target.sentAt };
}
