import type { Target } from "../map-target";
import type { DataMessage } from "../schemas";
import type { Content } from "../text";
import { EMPTY, type MappedEnvelope } from "./types";

/**
 * Whether a payload carries anything a thread should show.
 *
 * A sticker, a poll, a pin, a group-call update, a payment and a shared contact all arrive as
 * `dataMessage` objects. Mapping them as messages writes a row with an empty body and no
 * files: a blank line in the thread, a bumped conversation, an unread count and a
 * notification with no words in it — and a ringing group call emits one every few seconds.
 * They are events about something else, so no message is built for them.
 *
 * A view-once message is the one payload whose content is empty *on purpose*: the sender asked
 * for it not to be kept, and the row with its notice is what records that it arrived.
 */
export const carriesContent = (content: Content): boolean =>
	content.body.length > 0 || content.attachments.length > 0 || content.isViewOnce === true;

/**
 * A timer change is a conversation fact with no message of its own.
 *
 * Signal announces "the timer is now N seconds" as a data message whose whole payload is
 * `isExpirationUpdate` plus `expiresInSeconds`. The number matters: it is what stamps our own
 * outgoing messages, so a client that drops it keeps sending text under a timer that was
 * switched on (or expires messages under one that was switched off). Nothing is inserted, so
 * no row and no unread count: only the conversation learns the new value.
 */
export function timerChange(target: Target, data: DataMessage): MappedEnvelope | null {
	const seconds = data.isExpirationUpdate === true ? data.expiresInSeconds : undefined;
	if (typeof seconds !== "number") {
		return null;
	}
	return {
		...EMPTY,
		conversationKind: target.kind,
		conversation: {
			id: target.id,
			name: target.name,
			unreadCount: 0,
			lastActivityAt: data.timestamp,
			expiresInSeconds: seconds,
		},
	};
}
