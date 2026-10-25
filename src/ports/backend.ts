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
	sendMessage(conversationId: ConversationId, body: string): Promise<SendResult>;
	subscribe(listener: (event: BackendEvent) => void): () => void;
}
