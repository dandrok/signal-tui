import { SELF_LABEL } from "../../domain/format";
import type { Conversation, ConversationId, Message, MessageId } from "../../domain/types";
import type { DataMessage, Envelope, SentMessage } from "./schemas";

export type ConversationKind = "direct" | "group";

/** Identity of a message that a `remoteDelete` refers to. */
export interface DeletedMessage {
	readonly conversationId: ConversationId;
	readonly messageId: MessageId;
}

/**
 * A received envelope translated into domain objects. Every field can be empty:
 * typing and receipt envelopes carry no message, and a delete notification
 * carries no message of its own — only a reference to an earlier one.
 */
export interface MappedEnvelope {
	readonly message: Message | null;
	readonly conversation: Conversation | null;
	readonly conversationKind: ConversationKind;
	readonly deleted: DeletedMessage | null;
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

const ATTACHMENT_PLACEHOLDER = "[attachment]";

interface Textual {
	readonly message?: string | null | undefined;
	readonly attachments?: readonly unknown[] | undefined;
}

const bodyOf = (data: Textual): string => {
	if (data.message !== undefined && data.message !== null) {
		return data.message;
	}
	return (data.attachments?.length ?? 0) > 0 ? ATTACHMENT_PLACEHOLDER : "";
};

const EMPTY: MappedEnvelope = {
	message: null,
	conversation: null,
	conversationKind: "direct",
	deleted: null,
};

const groupTarget = (groupInfo: DataMessage["groupInfo"]): Target | null =>
	groupInfo === undefined
		? null
		: { id: groupInfo.groupId, name: groupInfo.groupName ?? "", kind: "group" };

/** Incoming message: the sender identifies the conversation. */
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
			message: null,
			conversation: null,
			conversationKind: target.kind,
			deleted: {
				conversationId: target.id,
				messageId: `${target.id}:${data.remoteDelete.timestamp}`,
			},
		};
	}

	return {
		message: {
			id: `${target.id}:${data.timestamp}`,
			conversationId: target.id,
			author: peerName(envelope),
			body: bodyOf(data),
			sentAt: data.timestamp,
			isOutgoing: false,
			isDeleted: false,
		},
		conversation: {
			id: target.id,
			name: target.name,
			// The count is owned by the store: the session increments it per incoming
			// message, so mapping must not guess a total.
			unreadCount: 0,
			lastActivityAt: data.timestamp,
		},
		conversationKind: target.kind,
		deleted: null,
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
			message: null,
			conversation: null,
			conversationKind: target.kind,
			deleted: {
				conversationId: target.id,
				messageId: `${target.id}:${sent.remoteDelete.timestamp}`,
			},
		};
	}

	return {
		message: {
			id: `${target.id}:${sent.timestamp}`,
			conversationId: target.id,
			author: SELF_LABEL,
			body: bodyOf(sent),
			sentAt: sent.timestamp,
			isOutgoing: true,
			isDeleted: false,
		},
		conversation: {
			id: target.id,
			name: target.name,
			unreadCount: 0,
			lastActivityAt: sent.timestamp,
		},
		conversationKind: target.kind,
		deleted: null,
	};
}

/**
 * Pure envelope → domain mapping. No IO, no clock reads: the same envelope always
 * produces the same result, which is what makes the adapter testable from fixtures.
 */
export function mapEnvelope(envelope: Envelope): MappedEnvelope {
	if (envelope.dataMessage !== undefined) {
		return mapIncoming(envelope, envelope.dataMessage);
	}

	const sent = envelope.syncMessage?.sentMessage;
	if (sent !== undefined) {
		return mapSent(sent);
	}

	return EMPTY;
}
