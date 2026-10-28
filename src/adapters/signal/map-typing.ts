import type { ConversationId } from "../../domain/types";
import { type ConversationKind, peerId, peerName } from "./map-target";
import type { Envelope, TypingMessage } from "./schemas";

/**
 * "Someone is writing", which is state rather than content: it must never reach the cache.
 *
 * A typing notice names a group when it belongs to one and carries no group *name*, so the
 * conversation is keyed here from what the envelope does say. The label is the sender's, and
 * it is only ever shown for a few seconds — nothing of it is stored, so nothing of it survives
 * a restart, which is the whole difference between this and a message.
 */

export interface MappedTyping {
	readonly conversationId: ConversationId;
	/**
	 * Which kind of conversation it belongs to. Carried because a typing notice can be the
	 * first thing this session sees from a group: without the kind the group id is never
	 * registered as one, and a later send addresses it as if the id were a recipient.
	 */
	readonly conversationKind: ConversationKind;
	/** Who is writing, for the one line that says so. */
	readonly author: string;
	readonly isTyping: boolean;
}

export function mapTyping(envelope: Envelope, typing: TypingMessage): MappedTyping | null {
	const peer = peerId(envelope);
	// The group a typing notice belongs to, else the peer. Neither is a message: an empty
	// name here is deliberate, because a placeholder would overwrite the name the thread has.
	const conversationId = typing.groupId ?? peer;
	if (conversationId === null) {
		return null;
	}

	// An action this build does not know is ignored rather than guessed at: the two that
	// exist are opposites, and reading an unknown one as "started" would leave a client
	// showing a stranger typing forever.
	const action = typing.action.toUpperCase();
	if (action !== "STARTED" && action !== "STOPPED") {
		return null;
	}

	return {
		conversationId,
		conversationKind: typing.groupId != null ? "group" : "direct",
		author: peerName(envelope),
		isTyping: action === "STARTED",
	};
}
