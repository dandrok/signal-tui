import type { Conversation, ConversationId, Message, MessageId } from "../domain/types";

export type BackendEvent =
	| { readonly kind: "message"; readonly message: Message }
	| { readonly kind: "conversation-updated"; readonly conversation: Conversation }
	| {
			readonly kind: "message-deleted";
			readonly conversationId: ConversationId;
			readonly messageId: MessageId;
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
