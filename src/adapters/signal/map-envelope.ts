import { ATTACHMENT_BODY_PLACEHOLDER, SELF_LABEL } from "../../domain/format";
import type {
	Attachment,
	Conversation,
	ConversationId,
	Message,
	MessageId,
} from "../../domain/types";
import type { DataMessage, EditMessage, Envelope, SentMessage } from "./schemas";
import { dataMessageSchema } from "./schemas";

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
	readonly body: string;
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
	readonly edited: EditedMessage | null;
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

const ATTACHMENT_PLACEHOLDER = ATTACHMENT_BODY_PLACEHOLDER;

interface Textual {
	readonly message?: string | null | undefined;
	readonly attachments?: readonly unknown[] | undefined;
}

/**
 * One file from the wire. Everything is optional in signal-cli's output, so each
 * field is narrowed rather than trusted; a null entry (older releases send those)
 * is dropped by the caller.
 */
function toAttachment(raw: unknown): Attachment | null {
	if (raw === null || typeof raw !== "object") {
		return null;
	}
	const entry = raw as Record<string, unknown>;
	const text = (value: unknown): string | null => (typeof value === "string" ? value : null);
	return {
		id: text(entry.id),
		contentType: text(entry.contentType),
		filename: text(entry.filename),
		size: typeof entry.size === "number" && Number.isFinite(entry.size) ? entry.size : null,
		caption: text(entry.caption),
		isVoiceNote: entry.isVoiceNote === true,
	};
}

/** Files carried by a message, in the order signal-cli listed them. */
export function mapAttachments(raw: readonly unknown[] | undefined): readonly Attachment[] {
	return (raw ?? []).map(toAttachment).filter((entry): entry is Attachment => entry !== null);
}

/** Caption of the first file that has one; signal-cli keeps it there, not in `message`. */
const captionOf = (data: Textual): string | null => {
	for (const raw of data.attachments ?? []) {
		const caption = (raw as { caption?: unknown } | null)?.caption;
		if (typeof caption === "string" && caption.length > 0) {
			return caption;
		}
	}
	return null;
};

/** The text a message actually carries: its body, or a file's caption. */
const textOf = (data: Textual): string => {
	if (data.message !== undefined && data.message !== null && data.message.length > 0) {
		return data.message;
	}
	// A photo sent with text puts that text in the attachment's caption, so without
	// this the message would show only a filename. It also keeps captions searchable.
	return captionOf(data) ?? "";
};

const bodyOf = (data: Textual): string => {
	const text = textOf(data);
	if (text.length > 0) {
		return text;
	}
	// Files with no text at all still deserve a row of their own.
	return (data.attachments?.length ?? 0) > 0 ? ATTACHMENT_PLACEHOLDER : "";
};

const EMPTY: MappedEnvelope = {
	message: null,
	conversation: null,
	conversationKind: "direct",
	deleted: null,
	edited: null,
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
		message: null,
		conversation: null,
		conversationKind: target.kind,
		deleted: null,
		edited: {
			conversationId: target.id,
			targetSentAt: edit.targetSentTimestamp,
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
			message: null,
			conversation: null,
			conversationKind: target.kind,
			edited: null,
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
			attachments: mapAttachments(data.attachments),
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
		edited: null,
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
			edited: null,
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
			attachments: mapAttachments(sent.attachments),
		},
		conversation: {
			id: target.id,
			name: target.name,
			unreadCount: 0,
			lastActivityAt: sent.timestamp,
		},
		conversationKind: target.kind,
		deleted: null,
		edited: null,
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

	if (envelope.dataMessage !== undefined) {
		return mapIncoming(envelope, envelope.dataMessage);
	}

	const sent = envelope.syncMessage?.sentMessage;
	if (sent !== undefined) {
		return mapSent(sent);
	}

	return EMPTY;
}
