import { mapReaction } from "../map-reaction";
import { conversationTarget, groupTarget, peerId, peerName } from "../map-target";
import type { DataMessage, Envelope } from "../schemas";
import { contentOf, expiresAtOf } from "../text";
import { carriesContent, timerChange } from "./content";
import { EMPTY, type MappedEnvelope } from "./types";

/**
 * A message someone else sent.
 *
 * The order below is the whole rule: a reaction and a delete ride inside a data message but are
 * not messages, a payload with no content is not a message, and one of those content-free
 * payloads — a timer change — still says something about the conversation.
 */
export function mapIncoming(envelope: Envelope, data: DataMessage): MappedEnvelope {
	const peer = peerId(envelope);
	const target =
		groupTarget(data.groupInfo) ?? (peer === null ? null : conversationTarget(envelope));

	if (target === null) {
		return EMPTY;
	}

	// A reaction rides inside a data message but is not one: treating it as a message would
	// leave a blank row in the thread for every emoji a peer adds.
	if (data.reaction !== undefined) {
		const reaction = mapReaction(target, data.reaction, {
			id: peerId(envelope),
			label: peerName(envelope),
		});
		return reaction === null ? EMPTY : { ...EMPTY, conversationKind: target.kind, reaction };
	}

	// A delete-for-everyone names the message it removes; it is not a new message.
	if (data.remoteDelete !== undefined) {
		return {
			...EMPTY,
			conversationKind: target.kind,
			deleted: {
				conversationId: target.id,
				messageId: `${target.id}:${data.remoteDelete.timestamp}`,
			},
		};
	}

	const content = contentOf(data);
	if (!carriesContent(content)) {
		// A timer change is the one content-free payload that still says something: it moves
		// the conversation's timer, and dropping it leaves that number stale.
		return timerChange(target, data) ?? EMPTY;
	}
	const expiresAt = expiresAtOf(data);

	return {
		...EMPTY,
		message: {
			id: `${target.id}:${data.timestamp}`,
			conversationId: target.id,
			author: peerName(envelope),
			...(peer === null ? {} : { authorId: peer }),
			sentAt: data.timestamp,
			isOutgoing: false,
			isDeleted: false,
			...(expiresAt === undefined ? {} : { expiresAt }),
			...content,
		},
		conversation: {
			id: target.id,
			name: target.name,
			// The count is owned by the store: the session increments it per incoming message,
			// so mapping must not guess a total.
			unreadCount: 0,
			lastActivityAt: data.timestamp,
			// The timer rides on the message; the conversation keeps it so our own outgoing
			// messages can be stamped without waiting for a transcript.
			...(data.expiresInSeconds === undefined || data.expiresInSeconds === null
				? {}
				: { expiresInSeconds: data.expiresInSeconds }),
		},
		conversationKind: target.kind,
	};
}
