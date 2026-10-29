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
 * A file that came with a message: where the engine put it, and what to call it.
 * The two are different fields, and reading one for the other is a live bug — see
 * `usecases/open`.
 */
/** Who asked for a change, as both a stable id and the label shown on screen. */
export interface EditAuthor {
	readonly id: string | null;
	readonly label: string;
}

/** Stable identity for our own messages, which no peer can claim. */
export const SELF_AUTHOR_ID = "self";

/**
 * One reaction on a message: what was added, and who added it. Signal clients hold a
 * single reaction per person per message, so a new emoji from the same person replaces
 * the previous one and a removal takes it away.
 */
export interface Reaction {
	readonly emoji: string;
	/** Display label of the reactor, for a pane that only needs a count. */
	readonly author: string;
	/** Stable identity of the reactor — the key a replacement or removal matches. */
	readonly authorId: string;
}

/**
 * How far one of our own messages has travelled, as reported by the other side:
 * their device has it ("delivered"), they opened the conversation ("read"), or they
 * opened a view-once message ("viewed").
 */
export type ReceiptState = "delivered" | "read" | "viewed";

/**
 * What a reply quotes: the identity of the quoted message, not a copy of it.
 *
 * Signal names the quoted message by the timestamp it was sent at — the same identity an
 * edit and a delete-for-everyone use — so the cache can resolve it against the thread it
 * sits in, and the pane reads its text from that row. Keeping the payload's copy of the
 * words instead would store somebody's text twice and make every delete and expiry rule
 * chase it into the reply as well.
 */
export interface QuotedMessage {
	readonly sentAt: number;
	/**
	 * Identity of the quoted author: their uuid, else their number, else null when the
	 * payload named neither. The payload carries no display name for a third party, so the
	 * label is resolved from the cached message when the thread still has it — and this is
	 * what names the author when it does not.
	 */
	readonly authorId: string | null;
}

export interface Attachment {
	/**
	 * The name `signal-cli` saved the file under **inside its own attachments directory**,
	 * extension included — the local path is that directory plus this. Null when the engine kept
	 * no copy (it was told not to download, or the file is one we sent).
	 */
	readonly id: string | null;
	readonly contentType: string | null;
	/**
	 * The name the file was *sent* with, for display: `signal-2026-10-24-203528.jpeg` is a name,
	 * not a path, and nothing on disk is called that. Our own sends carry the path we picked
	 * here, because that is the only name there is for them.
	 */
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
	 * The strongest receipt the other side has sent for this message. Only our own
	 * messages can carry one, and only until something strengthens it: absent means
	 * "nobody has acknowledged this yet", which is also what every row cached before
	 * receipts were mapped reports.
	 */
	readonly receipt?: ReceiptState;
	/**
	 * True for a message the sender marked view-once. Their request outranks showing it:
	 * the text and the file references are never written to the cache, so this row
	 * records only that such a message arrived.
	 */
	readonly isViewOnce?: boolean;
	/**
	 * Reactions left on this message, one per person. Absent when nobody reacted, and
	 * absent on rows cached before reactions were mapped.
	 */
	readonly reactions?: readonly Reaction[];
	/**
	 * What this message replies to. Absent when it is not a reply, and on rows cached
	 * before quotes were mapped. Only the identity is stored: the text the pane shows comes
	 * from the quoted message itself, so nothing of somebody's words is kept twice.
	 */
	readonly quote?: QuotedMessage;
	/**
	 * Optional so a caller that only cares about text is not forced to spell out
	 * an empty list; `attachmentsOf` reads it without null checks.
	 */
	readonly attachments?: readonly Attachment[];
}
