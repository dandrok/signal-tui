import type { Conversation, ConversationId, Message, MessageId } from "../../domain/types";
import type { Envelope } from "./schemas";

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
		return { id: group.groupId, name: group.groupName ?? "Group", kind: "group" };
	}

	const id = peerId(envelope);
	if (id === null) {
		return null;
	}
	return { id, name: peerName(envelope), kind: "direct" };
}

const ATTACHMENT_PLACEHOLDER = "[attachment]";

/**
 * Pure envelope → domain mapping. No IO, no clock reads: the same envelope always
 * produces the same result, which is what makes the adapter testable from fixtures.
 */
export function mapEnvelope(envelope: Envelope): MappedEnvelope {
	const data = envelope.dataMessage;
	const target = data === undefined ? null : conversationTarget(envelope);

	if (data === undefined || target === null) {
		return { message: null, conversation: null, conversationKind: "direct", deleted: null };
	}

	// A delete-for-everyone names the message it removes; it is not a new message.
	const remoteDelete = data.remoteDelete;
	if (remoteDelete !== undefined) {
		return {
			message: null,
			conversation: null,
			conversationKind: target.kind,
			deleted: { conversationId: target.id, messageId: `${target.id}:${remoteDelete.timestamp}` },
		};
	}

	const hasAttachments = (data.attachments?.length ?? 0) > 0;
	const body = data.message ?? (hasAttachments ? ATTACHMENT_PLACEHOLDER : "");

	const message: Message = {
		id: `${target.id}:${data.timestamp}`,
		conversationId: target.id,
		author: peerName(envelope),
		body,
		sentAt: data.timestamp,
		isOutgoing: false,
		isDeleted: false,
	};

	const conversation: Conversation = {
		id: target.id,
		name: target.name,
		unreadCount: 1,
		lastActivityAt: data.timestamp,
	};

	return { message, conversation, conversationKind: target.kind, deleted: null };
}
