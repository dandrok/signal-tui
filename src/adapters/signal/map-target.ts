import type { ConversationId } from "../../domain/types";
import type { DataMessage, Envelope } from "./schemas";

/**
 * Who is talking to whom: the peer identity in an envelope and the conversation a
 * payload belongs to. Split from the envelope mapper because three mappers need the
 * same rules — a message, an edit and a reaction all resolve their target this way,
 * and a second copy of "the group id wins" is how two of them drift apart.
 */
export type ConversationKind = "direct" | "group";

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

export interface Target {
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

/** The group a data message belongs to, or null for a direct conversation. */
export const groupTarget = (groupInfo: DataMessage["groupInfo"]): Target | null =>
	groupInfo === undefined
		? null
		: { id: groupInfo.groupId, name: groupInfo.groupName ?? "", kind: "group" };
