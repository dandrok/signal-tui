import type {
	Conversation,
	ConversationId,
	EditAuthor,
	Message,
	MessageId,
} from "../../../domain/types";
import type { MappedReaction } from "../map-reaction";
import type { MappedReceipt } from "../map-receipt";
import type { ConversationKind } from "../map-target";
import type { MappedTyping } from "../map-typing";

/**
 * What a mapper may say, and the empty answer it says it with.
 *
 * Every field can be null because most envelopes carry one thing: a typing envelope carries
 * nothing, a delete names an earlier message instead of bringing one, a receipt names what it
 * acknowledges by timestamp, and a reaction rides inside a data message without being one.
 */

/** Identity of a message that a `remoteDelete` refers to, and of whoever asked to remove it. */
export interface DeletedMessage {
	readonly conversationId: ConversationId;
	readonly messageId: MessageId;
	/** Only the author's own message may be removed; the store is where that is checked. */
	readonly deleter: EditAuthor;
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
	/** Someone is (or stopped) writing. State, never content: nothing is stored. */
	readonly typing: MappedTyping | null;
}

export const EMPTY: MappedEnvelope = {
	message: null,
	conversation: null,
	conversationKind: "direct",
	deleted: null,
	edited: null,
	receipt: null,
	reaction: null,
	typing: null,
};
