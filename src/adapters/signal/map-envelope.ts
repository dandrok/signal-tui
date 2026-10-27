import { SELF_LABEL } from "../../domain/format";
import type {
	Conversation,
	ConversationId,
	EditAuthor,
	Message,
	MessageId,
} from "../../domain/types";
import { SELF_AUTHOR_ID } from "../../domain/types";
import { mapEditPayload } from "./map-edit";
import type { MappedReaction } from "./map-reaction";
import { mapReaction } from "./map-reaction";
import { type MappedReceipt, mapReceipt } from "./map-receipt";
import {
	type ConversationKind,
	conversationTarget,
	groupTarget,
	peerId,
	peerName,
	type Target,
} from "./map-target";
import type { DataMessage, EditMessage, Envelope, SentMessage } from "./schemas";
import { type Content, contentOf, expiresAtOf } from "./text";

/**
 * Identity our own actions carry when the engine echoes them back as a transcript: a
 * reaction we added, or an edit we made, on another device. `SELF_AUTHOR_ID` is the
 * marker our own rows store, so an edit resolves to the message it corrects.
 */
const SELF_ACTOR: EditAuthor = { id: SELF_AUTHOR_ID, label: SELF_LABEL };

/** Identity of a message that a `remoteDelete` refers to. */
export interface DeletedMessage {
	readonly conversationId: ConversationId;
	readonly messageId: MessageId;
}

/**
 * Replacement content for an earlier message. Signal identifies the message by
 * the timestamp it was sent at, so that is the key the store updates on.
 */
export interface EditedMessage {
	readonly conversationId: ConversationId;
	readonly targetSentAt: number;
	/** The peer that asked for the change; only their own message may be rewritten. */
	readonly editor: EditAuthor;
	readonly body: string;
}

/**
 * A received envelope translated into domain objects. Every field can be empty:
 * typing envelopes carry no message, and a delete notification carries no message
 * of its own — only a reference to an earlier one. So does a receipt: it names the
 * messages it acknowledges by timestamp instead of carrying one.
 */
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

const EMPTY: MappedEnvelope = {
	message: null,
	conversation: null,
	conversationKind: "direct",
	deleted: null,
	edited: null,
	receipt: null,
	reaction: null,
};

/**
 * Whether a payload carries anything a thread should show.
 *
 * A sticker, a poll, a pin, a group-call update, a payment and a shared contact all
 * arrive as `dataMessage` objects. Mapping them as messages writes a row with an empty
 * body and no files: a blank line in the thread, a bumped conversation, an unread count
 * and a notification with no words in it — and a ringing group call emits one every few
 * seconds. They are events about something else, so no message is built for them.
 *
 * A view-once message is the one payload whose content is empty *on purpose*: the sender
 * asked for it not to be kept, and the row with its notice is what records that it
 * arrived.
 */
const carriesContent = (content: Content): boolean =>
	content.body.length > 0 || content.attachments.length > 0 || content.isViewOnce === true;

/**
 * An edit, wrapped as an event rather than a message. The rule that decides which
 * conversation it lands in and whether it carries real text lives in `map-edit.ts`.
 */
function editEnvelope(edit: EditMessage, target: Target, editor: EditAuthor): MappedEnvelope {
	const mapped = mapEditPayload(edit, target, editor);
	if (mapped === null) {
		return { ...EMPTY, conversationKind: target.kind };
	}
	return {
		...EMPTY,
		conversationKind: mapped.conversationKind,
		edited: {
			conversationId: mapped.conversationId,
			targetSentAt: mapped.targetSentAt,
			editor: mapped.editor,
			body: mapped.body,
		},
	};
}

/** An edit from someone else: the envelope's sender is the editor. */
function mapEdit(envelope: Envelope, edit: EditMessage): MappedEnvelope {
	const target = conversationTarget(envelope);
	if (target === null) {
		return EMPTY;
	}
	return editEnvelope(edit, target, { id: peerId(envelope), label: peerName(envelope) });
}

function mapIncoming(envelope: Envelope, data: DataMessage): MappedEnvelope {
	const peer = peerId(envelope);
	const target =
		groupTarget(data.groupInfo) ?? (peer === null ? null : conversationTarget(envelope));

	if (target === null) {
		return EMPTY;
	}

	// A reaction rides inside a data message but is not one: treating it as a message
	// would leave a blank row in the thread for every emoji a peer adds.
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
		return EMPTY;
	}
	const expiresAt = expiresAtOf(data);

	return {
		...EMPTY,
		message: {
			id: `${target.id}:${data.timestamp}`,
			conversationId: target.id,
			author: peerName(envelope),
			...(peerId(envelope) === null ? {} : { authorId: peerId(envelope) as string }),
			sentAt: data.timestamp,
			isOutgoing: false,
			isDeleted: false,
			...(expiresAt === undefined ? {} : { expiresAt }),
			...content,
		},
		conversation: {
			id: target.id,
			name: target.name,
			// The count is owned by the store: the session increments it per incoming
			// message, so mapping must not guess a total.
			unreadCount: 0,
			lastActivityAt: data.timestamp,
			// The timer rides on the message; the conversation keeps it so our own
			// outgoing messages can be stamped without waiting for a transcript.
			...(data.expiresInSeconds === undefined || data.expiresInSeconds === null
				? {}
				: { expiresInSeconds: data.expiresInSeconds }),
		},
		conversationKind: target.kind,
	};
}

/** One of your own messages, echoed to this device as a sync transcript. */
function mapSent(sent: SentMessage): MappedEnvelope {
	const destination = sent.destinationUuid ?? sent.destinationNumber ?? sent.destination ?? null;
	const target =
		groupTarget(sent.groupInfo) ??
		(destination === null ? null : { id: destination, name: "", kind: "direct" as const });

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

	// Our own edit, made on another device: the transcript holds `editMessage` and no
	// data message of its own, so it corrects a stored row and is never a new one.
	if (sent.editMessage !== undefined) {
		return editEnvelope(sent.editMessage, target, SELF_ACTOR);
	}

	// A transcript with no timestamp cannot name a message: that timestamp is the row's
	// identity, so building one writes an id ending in "undefined" and a NULL `sent_at`
	// the cache refuses — an error notice for a payload that simply carried no message.
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

/**
 * Pure envelope → domain mapping. No IO, no clock reads: the same envelope always
 * produces the same result, which is what makes the adapter testable from fixtures.
 */
export function mapEnvelope(envelope: Envelope): MappedEnvelope {
	if (envelope.editMessage !== undefined) {
		return mapEdit(envelope, envelope.editMessage);
	}

	if (envelope.receiptMessage !== undefined) {
		// A receipt acknowledges messages we already sent; it never inserts one.
		const receipt = mapReceipt(envelope.receiptMessage);
		return receipt === null ? EMPTY : { ...EMPTY, receipt };
	}

	if (envelope.dataMessage !== undefined) {
		return mapIncoming(envelope, envelope.dataMessage);
	}

	const sent = envelope.syncMessage?.sentMessage;
	if (sent !== undefined) {
		return mapSent(sent);
	}

	return EMPTY;
}
