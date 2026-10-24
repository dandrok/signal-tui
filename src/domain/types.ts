export type ConversationId = string;
export type MessageId = string;

export interface Conversation {
	readonly id: ConversationId;
	readonly name: string;
	readonly unreadCount: number;
	readonly lastActivityAt: number;
	/**
	 * The conversation's disappearing-message timer, in seconds; 0 means switched
	 * off and absent means the cache has not been told. Needed for our own outgoing
	 * messages, which never come back from Signal and so carry no timer of their own.
	 */
	readonly expiresInSeconds?: number;
}

/**
 * A file that came with a message. `filename` is what signal-cli handed us,
 * which for a received attachment is the path it downloaded to; rendering uses
 * the last path segment, so the label stays readable either way.
 */
/** Who asked for a change, as both a stable id and the label shown on screen. */
export interface EditAuthor {
	readonly id: string | null;
	readonly label: string;
}

/** Stable identity for our own messages, which no peer can claim. */
export const SELF_AUTHOR_ID = "self";

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
	/**
	 * Stable identity of the sender — a uuid where Signal gives one, a phone number
	 * otherwise, and `SELF_AUTHOR_ID` for our own messages. `author` is the display
	 * label and can be changed by the peer at any time, so it must never be the key
	 * an edit is matched on.
	 *
	 * Absent on rows cached before schema v4; `applyEdit` falls back to the label
	 * for those and to nothing else.
	 */
	readonly authorId?: string;
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
	 * When the sender's disappearing-message timer takes this message away, as an
	 * epoch millisecond stamp. Absent when the conversation has no timer.
	 */
	readonly expiresAt?: number;
	/**
	 * True once the timer ran out. The row stays so the thread keeps its shape, but
	 * its body and files are gone — see `purgeExpired`.
	 */
	readonly isExpired?: boolean;
	/**
	 * Optional so a caller that only cares about text is not forced to spell out
	 * an empty list; `attachmentsOf` reads it without null checks.
	 */
	readonly attachments?: readonly Attachment[];
}
