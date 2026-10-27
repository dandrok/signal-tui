import type { ConversationId, Message } from "../../domain/types";
import type { ReplyTarget, SignalBackend } from "../../ports/backend";
import type { MessageStore } from "../../ports/store";

/** Milliseconds source; injectable so expiry tests need no sleeps. */
export interface SessionDeps {
	readonly store: MessageStore;
	readonly backend: SignalBackend;
	readonly clock?: () => number;
}

/** What the UI needs to announce an arriving message, and nothing more. */
export interface IncomingNotice {
	/** The message as the store will keep it — the UI renders it through `describeBody`. */
	readonly message: Message;
	/** The name the cache knows for that conversation; empty when it has none yet. */
	readonly conversationName: string;
}

/**
 * Joins the transport to the cache: every backend event is persisted, then
 * listeners are told something changed. Writes are serialised through one queue
 * so a fast burst of envelopes cannot interleave and land out of order (a
 * message before the conversation that owns it would break the foreign key).
 */
export interface Session {
	start(): Promise<void>;
	stop(): Promise<void>;
	/** Sends `body`, optionally as a reply to an earlier message. */
	send(conversationId: ConversationId, body: string, replyTo?: ReplyTarget): Promise<void>;
	/** Clears the unread count for a conversation the user is looking at. */
	markRead(conversationId: ConversationId): Promise<void>;
	/** Resolves once every queued write has been applied. */
	flush(): Promise<void>;
	onChange(listener: () => void): () => void;
	/**
	 * Fires once per message that was *newly* stored and came from someone else — the
	 * event a notification is made of. A replayed envelope does not fire it, and neither
	 * does our own echo: the point is "something arrived that you have not seen".
	 */
	onIncoming(listener: (notice: IncomingNotice) => void): () => void;
	readonly errors: readonly string[];
}

/**
 * What every part of a session needs from the whole: the two ports, the clock, and the
 * three things that only exist once — the write queue, the redraw signal and the error log.
 *
 * The use cases in this folder take this instead of a dozen positional arguments, and they
 * never import each other.
 */
export interface SessionContext {
	readonly store: MessageStore;
	readonly backend: SignalBackend;
	readonly now: () => number;
	/** Serialised writes: one queue, so a message never lands before its conversation. */
	readonly enqueue: (work: () => Promise<void>) => Promise<void>;
	/** Tells the UI something in the cache changed. */
	readonly notify: () => void;
	/** Announces a newly stored incoming message to whoever listens for notifications. */
	readonly announce: (message: Message) => void;
	/** Records a failure for `session.errors`; never throws. */
	readonly record: (error: unknown) => void;
	/** The thread name learned from an earlier `conversation-updated`, or "". */
	readonly nameOf: (conversationId: ConversationId) => string;
	readonly learnName: (conversationId: ConversationId, name: string) => void;
}
