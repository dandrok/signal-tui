import type { MessageRef } from "../domain/message-ref";
import type {
	Conversation,
	ConversationId,
	EditAuthor,
	Message,
	MessageId,
	ReceiptState,
} from "../domain/types";

export type BackendEvent =
	| { readonly kind: "message"; readonly message: Message }
	| { readonly kind: "conversation-updated"; readonly conversation: Conversation }
	| {
			/** The sender replaced the body of a message already on screen. */
			readonly kind: "message-edited";
			readonly conversationId: ConversationId;
			readonly targetSentAt: number;
			/** Who edited: only that author's own message may be rewritten. */
			readonly editor: EditAuthor;
			readonly body: string;
	  }
	| {
			readonly kind: "message-deleted";
			readonly conversationId: ConversationId;
			readonly messageId: MessageId;
	  }
	| {
			/**
			 * The other side acknowledged messages we sent, naming them by their
			 * timestamps. Carries no conversation: a receipt payload has none, so the
			 * store resolves the rows by the identity Signal itself uses.
			 */
			readonly kind: "receipt";
			readonly timestamps: readonly number[];
			readonly state: ReceiptState;
	  }
	| {
			/**
			 * Someone reacted to (or removed a reaction from) a message we already have,
			 * naming it by its timestamp. Never inserts a message of its own.
			 */
			readonly kind: "reaction";
			readonly conversationId: ConversationId;
			readonly targetSentAt: number;
			readonly reactor: EditAuthor;
			readonly emoji: string;
			readonly isRemove: boolean;
	  }
	| {
			/**
			 * A peer started or stopped writing. State, not content: the session keeps it in
			 * memory and it expires, so a restart never shows someone typing.
			 */
			readonly kind: "typing";
			readonly conversationId: ConversationId;
			readonly author: string;
			readonly isTyping: boolean;
	  };

/**
 * Live transport port. The first adapter wraps `signal-cli` JSON-RPC;
 * a later one can speak to a Rust backend without touching the app layer.
 */
/** What the transport knows about a sent message. */
export interface SendResult {
	/**
	 * Server timestamp assigned to the message. It is the identity every other
	 * device sees, so deletes and later sync transcripts refer to it.
	 */
	readonly timestamp: number | undefined;
}

export type ReceiptType = "read" | "viewed";

/**
 * The message a reply answers, as the transport needs it.
 *
 * `send` takes the target by timestamp plus its author, and both are mandatory once a
 * quote is sent — the engine refuses a `quoteTimestamp` without a `quoteAuthor`. The text
 * travels too: recipients render the quoted block from the payload, so omitting it would
 * show them an empty quote.
 */
export interface ReplyTarget {
	/** When the quoted message was sent; the identity Signal uses for it. */
	readonly sentAt: number;
	/**
	 * The quoted author's number or uuid. `SELF_AUTHOR_ID` is neither, so the adapter
	 * substitutes the account number for our own messages.
	 */
	readonly authorId: string;
	/** What the quoted message says, as this cache renders it. */
	readonly text: string;
}

export interface SignalBackend {
	start(): Promise<void>;
	stop(): Promise<void>;
	/**
	 * Tells the sender their messages were read. `recipient` is the conversation
	 * the messages belong to.
	 */
	sendReceipt(
		recipient: ConversationId,
		timestamps: readonly number[],
		type?: ReceiptType,
	): Promise<void>;
	/**
	 * Adds an emoji reaction to an earlier message, or removes our own.
	 *
	 * `target` names the message the way Signal does — when it was sent and who wrote it —
	 * because a reaction carries no conversation of its own.
	 */
	sendReaction(
		conversationId: ConversationId,
		target: MessageRef,
		emoji: string,
		isRemove?: boolean,
	): Promise<void>;
	/**
	 * Removes a message we sent from everyone's device.
	 *
	 * `remoteDelete` is its own JSON-RPC method, not a `send` variant, and it names the
	 * message by timestamp and author exactly as a reaction does.
	 */
	deleteForEveryone(conversationId: ConversationId, target: MessageRef): Promise<void>;
	/**
	 * Replaces the body of a message we sent.
	 *
	 * The engine takes the replacement text as an ordinary `send` carrying `editTimestamp` —
	 * the instant of the message being corrected — so the same address rules apply.
	 */
	sendEdit(conversationId: ConversationId, target: MessageRef, body: string): Promise<void>;
	/** Sends `body`, optionally as a reply to an earlier message. */
	sendMessage(
		conversationId: ConversationId,
		body: string,
		replyTo?: ReplyTarget,
	): Promise<SendResult>;
	subscribe(listener: (event: BackendEvent) => void): () => void;
}
