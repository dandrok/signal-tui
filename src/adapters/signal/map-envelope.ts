import type { Conversation, Message } from "../../domain/types";
import type { Envelope } from "./schemas";

/**
 * A received envelope translated into domain objects. Either field can be `null`
 * when the envelope carries no user-visible message (typing, receipts, sync, …).
 */
export interface MappedEnvelope {
	readonly message: Message | null;
	readonly conversation: Conversation | null;
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

const ATTACHMENT_PLACEHOLDER = "[attachment]";

/**
 * Pure envelope → domain mapping. No IO, no clock reads: the same envelope always
 * produces the same result, which is what makes the adapter testable from fixtures.
 */
export function mapEnvelope(envelope: Envelope): MappedEnvelope {
	const data = envelope.dataMessage;
	const conversationId = peerId(envelope);

	if (!data || conversationId === null) {
		return { message: null, conversation: null };
	}

	const hasAttachments = (data.attachments?.length ?? 0) > 0;
	const body = data.message ?? (hasAttachments ? ATTACHMENT_PLACEHOLDER : "");

	const message: Message = {
		id: `${conversationId}:${data.timestamp}`,
		conversationId,
		author: peerName(envelope),
		body,
		sentAt: data.timestamp,
		isOutgoing: false,
		isDeleted: data.remoteDelete !== undefined,
	};

	const conversation: Conversation = {
		id: conversationId,
		name: peerName(envelope),
		unreadCount: 1,
		lastActivityAt: data.timestamp,
	};

	return { message, conversation };
}
