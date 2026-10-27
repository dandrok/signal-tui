import { SELF_LABEL } from "../../../domain/format";
import type {
	Conversation,
	ConversationId,
	EditAuthor,
	Message,
	MessageId,
} from "../../../domain/types";
import { SELF_AUTHOR_ID } from "../../../domain/types";
import type { MappedReaction } from "../map-reaction";
import type { MappedReceipt } from "../map-receipt";
import type { ConversationKind } from "../map-target";

/**
 * What a mapper may say, and the empty answer it says it with.
 *
 * Every field can be null because most envelopes carry one thing: a typing envelope carries
 * nothing, a delete names an earlier message instead of bringing one, a receipt names what it
 * acknowledges by timestamp, and a reaction rides inside a data message without being one.
 */

/**
 * Identity our own actions carry when the engine echoes them back as a transcript: a reaction
 * we added, or an edit we made, on another device. `SELF_AUTHOR_ID` is the marker our own rows
 * store, so an edit resolves to the message it corrects.
 */
export const SELF_ACTOR: EditAuthor = { id: SELF_AUTHOR_ID, label: SELF_LABEL };

/** Identity of a message that a `remoteDelete` refers to. */
export interface DeletedMessage {
	readonly conversationId: ConversationId;
	readonly messageId: MessageId;
}

/**
 * Replacement content for an earlier message. Signal identifies the message by the timestamp
 * it was sent at, so that is the key the store updates on.
 */
export interface EditedMessage {
	readonly conversationId: ConversationId;
	readonly targetSentAt: number;
	/** The peer that asked for the change; only their own message may be rewritten. */
	readonly editor: EditAuthor;
	readonly body: string;
}

export interface MappedEnvelope {
	readonly message: Message | null;
	readonly conversation: Conversation | null;
	readonly conversationKind: ConversationKind;
	readonly deleted: DeletedMessage | null;
	readonly edited: EditedMessage | null;
	readonly receipt: MappedReceipt | null;
	/** A reaction on an existing message; never a message of its own. */
	readonly reaction: MappedReaction | null;
}

export const EMPTY: MappedEnvelope = {
	message: null,
	conversation: null,
	conversationKind: "direct",
	deleted: null,
	edited: null,
	receipt: null,
	reaction: null,
};
