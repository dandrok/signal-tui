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
export interface SignalBackend {
	start(): Promise<void>;
	stop(): Promise<void>;
	sendMessage(conversationId: ConversationId, body: string): Promise<void>;
	subscribe(listener: (event: BackendEvent) => void): () => void;
}
