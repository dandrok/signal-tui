import { SELF_LABEL } from "../../domain/format";
import type {
	Conversation,
	ConversationId,
	EditAuthor,
	Message,
	MessageId,
} from "../../domain/types";
import { SELF_AUTHOR_ID } from "../../domain/types";
import { mapAttachments } from "./map-attachments";
import { type MappedReceipt, mapReceipt } from "./map-receipt";
import type { DataMessage, EditMessage, Envelope, SentMessage } from "./schemas";
import { dataMessageSchema } from "./schemas";
import { bodyOf, expiresAtOf, textOf } from "./text";

export type ConversationKind = "direct" | "group";

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
}

/** Stable conversation key for a peer, preferring the UUID (numbers can change). */
export function peerId(envelope: Envelope): string | null {
	return envelope.sourceUuid ?? envelope.sourceNumber ?? envelope.source ?? null;
}

/** Human label for a peer, falling back through the identifiers we have. */
export function peerName(envelope: Envelope): string {
	return (
		envelope.sourceName ??
		envelope.sourceNumber ??
		envelope.sourceUuid ??
		envelope.source ??
		"unknown"
	);
}

interface Target {
	readonly id: ConversationId;
	/**
	 * Empty when the envelope does not name the conversation — a sync transcript
	 * only carries the destination id, and guessing would overwrite a name learned
	 * from an earlier incoming message.
	 */
	readonly name: string;
	readonly kind: ConversationKind;
}

/**
 * Where a message belongs: a group message is keyed by the group id, not by the
 * sender, otherwise every member's messages would open a separate conversation.
 */
export function conversationTarget(envelope: Envelope): Target | null {
	const group = envelope.dataMessage?.groupInfo;
	if (group !== undefined) {
		// Blank when unnamed: the stores treat a blank name as "unknown" and keep a
		// name learned earlier, where a placeholder like "Group" would overwrite it.
		return { id: group.groupId, name: group.groupName ?? "", kind: "group" };
	}

	const id = peerId(envelope);
	if (id === null) {
		return null;
	}
	return { id, name: peerName(envelope), kind: "direct" };
}

const EMPTY: MappedEnvelope = {
	message: null,
	conversation: null,
	conversationKind: "direct",
	deleted: null,
	edited: null,
	receipt: null,
};

const groupTarget = (groupInfo: DataMessage["groupInfo"]): Target | null =>
	groupInfo === undefined
		? null
		: { id: groupInfo.groupId, name: groupInfo.groupName ?? "", kind: "group" };

/** Incoming message: the sender identifies the conversation. */
/**
 * An edit carries a *copy* of the data message with the replacement text inside
 * it, so the conversation comes from that inner message's group info and falls
 * back to the envelope's sender. Anything without a body is ignored rather than
 * blanking the message: an edit to nothing is not a thing Signal produces.
 */
function mapEdit(envelope: Envelope, edit: EditMessage): MappedEnvelope {
	const parsed =
		edit.dataMessage === null || edit.dataMessage === undefined
			? null
			: dataMessageSchema.safeParse(edit.dataMessage);
	const data = parsed?.success === true ? parsed.data : undefined;
	const target =
		data?.groupInfo === undefined ? conversationTarget(envelope) : groupTarget(data.groupInfo);
	// Only real text may replace a body. `bodyOf` would answer "[attachment]" for a
	// data message that carries files and nothing else, which would replace the
	// message's text with a placeholder.
	const body = data === undefined ? "" : textOf(data);

	if (target === null || body.length === 0) {
		return target === null ? EMPTY : { ...EMPTY, conversationKind: target.kind };
	}

	return {
		...EMPTY,
		conversationKind: target.kind,
		edited: {
			conversationId: target.id,
			targetSentAt: edit.targetSentTimestamp,
			// The envelope sender is the editor: Signal refuses an edit from anyone
			// else, so a mismatch means the cache should not apply it.
			editor: { id: peerId(envelope), label: peerName(envelope) },
			body,
		},
	};
}

function mapIncoming(envelope: Envelope, data: DataMessage): MappedEnvelope {
	const peer = peerId(envelope);
	const target =
		groupTarget(data.groupInfo) ?? (peer === null ? null : conversationTarget(envelope));

	if (target === null) {
		return EMPTY;
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

	return {
		...EMPTY,
		message: {
			id: `${target.id}:${data.timestamp}`,
			conversationId: target.id,
			author: peerName(envelope),
			...(peerId(envelope) === null ? {} : { authorId: peerId(envelope) as string }),
			body: bodyOf(data),
			sentAt: data.timestamp,
			isOutgoing: false,
			isDeleted: false,
			...(expiresAtOf(data) === undefined ? {} : { expiresAt: expiresAtOf(data) as number }),
			attachments: mapAttachments(data.attachments),
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

	return {
		...EMPTY,
		message: {
			id: `${target.id}:${sent.timestamp}`,
			conversationId: target.id,
			author: SELF_LABEL,
			authorId: SELF_AUTHOR_ID,
			body: bodyOf(sent),
			sentAt: sent.timestamp,
			isOutgoing: true,
			isDeleted: false,
			...(expiresAtOf(sent) === undefined ? {} : { expiresAt: expiresAtOf(sent) as number }),
			attachments: mapAttachments(sent.attachments),
		},
		conversation: {
			id: target.id,
			name: target.name,
			unreadCount: 0,
			lastActivityAt: sent.timestamp,
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
