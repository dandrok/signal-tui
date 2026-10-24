export type ConversationId = string;
export type MessageId = string;

export interface Conversation {
	readonly id: ConversationId;
	readonly name: string;
	readonly unreadCount: number;
	readonly lastActivityAt: number;
}

/**
 * A file that came with a message. `filename` is what signal-cli handed us,
 * which for a received attachment is the path it downloaded to; rendering uses
 * the last path segment, so the label stays readable either way.
 */
export interface Attachment {
	readonly id: string | null;
	readonly contentType: string | null;
	readonly filename: string | null;
	readonly size: number | null;
	readonly caption: string | null;
	readonly isVoiceNote: boolean;
}

export interface Message {
	readonly id: MessageId;
	readonly conversationId: ConversationId;
	readonly author: string;
	readonly body: string;
	readonly sentAt: number;
	readonly isOutgoing: boolean;
	readonly isDeleted: boolean;
	/**
	 * True once the sender replaced this body. Displayed as a marker rather than
	 * as text, so the message reads exactly as the edit left it.
	 */
	readonly isEdited?: boolean;
	/**
	 * Optional so a caller that only cares about text is not forced to spell out
	 * an empty list; `attachmentsOf` reads it without null checks.
	 */
	readonly attachments?: readonly Attachment[];
}
