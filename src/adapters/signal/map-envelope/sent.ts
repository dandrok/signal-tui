import { SELF_LABEL } from "../../../domain/format";
import { SELF_AUTHOR_ID } from "../../../domain/types";
import { mapReaction } from "../map-reaction";
import { groupTarget } from "../map-target";
import type { SentMessage } from "../schemas";
import { contentOf, expiresAtOf } from "../text";
import { carriesContent } from "./content";
import { editEnvelope } from "./edit";
import { EMPTY, type MappedEnvelope, SELF_ACTOR } from "./types";

/**
 * One of your own messages, echoed to this device as a sync transcript.
 *
 * There is no `source` on this payload — the destination stands in for it — and a transcript
 * carries no display name, so the thread's name comes from the `conversation-updated` event
 * that precedes it. It also has no `sent_at` guarantee: a payload without a timestamp cannot
 * name a row, so it is dropped instead of being written with an id ending in "undefined".
 */
export function mapSent(sent: SentMessage): MappedEnvelope {
	const destination = sent.destinationUuid ?? sent.destinationNumber ?? sent.destination ?? null;
	const target =
		groupTarget(sent.groupInfo) ??
		(destination === null ? null : { id: destination, name: "", kind: "direct" as const });

	// Our own edit, made on another device: an edit to a group message arrives with no
	// destination at all, so the group comes from the edit's own data message. Resolving it
	// before the missing-destination check is what keeps those edits from vanishing.
	if (sent.editMessage !== undefined) {
		return editEnvelope(sent.editMessage, target, SELF_ACTOR);
	}

	if (target === null) {
		return EMPTY;
	}

	// Our own reaction, made on another device.
	if (sent.reaction !== undefined) {
		const reaction = mapReaction(target, sent.reaction, SELF_ACTOR);
		return reaction === null ? EMPTY : { ...EMPTY, conversationKind: target.kind, reaction };
	}

	if (sent.remoteDelete !== undefined) {
		return {
			...EMPTY,
			conversationKind: target.kind,
			deleted: {
				conversationId: target.id,
				messageId: `${target.id}:${sent.remoteDelete.timestamp}`,
			},
		};
	}

	// A transcript with no timestamp cannot name a message: that timestamp is the row's
	// identity, so building one writes an id ending in "undefined" and a NULL `sent_at` the
	// cache refuses — an error notice for a payload that simply carried no message.
	const sentAt = sent.timestamp;
	if (typeof sentAt !== "number") {
		return EMPTY;
	}

	const content = contentOf(sent);
	if (!carriesContent(content)) {
		return EMPTY;
	}
	const expiresAt = expiresAtOf({ timestamp: sentAt, expiresInSeconds: sent.expiresInSeconds });

	return {
		...EMPTY,
		message: {
			id: `${target.id}:${sentAt}`,
			conversationId: target.id,
			author: SELF_LABEL,
			authorId: SELF_AUTHOR_ID,
			sentAt,
			isOutgoing: true,
			isDeleted: false,
			...(expiresAt === undefined ? {} : { expiresAt }),
			...content,
		},
		conversation: {
			id: target.id,
			name: target.name,
			unreadCount: 0,
			lastActivityAt: sentAt,
			...(sent.expiresInSeconds === undefined || sent.expiresInSeconds === null
				? {}
				: { expiresInSeconds: sent.expiresInSeconds }),
		},
		conversationKind: target.kind,
	};
}
