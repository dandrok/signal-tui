export type ConversationId = string;
export type MessageId = string;

export interface Conversation {
	readonly id: ConversationId;
	readonly name: string;
	readonly unreadCount: number;
	readonly lastActivityAt: number;
}

export interface Message {
	readonly id: MessageId;
	readonly conversationId: ConversationId;
	readonly author: string;
	readonly body: string;
	readonly sentAt: number;
	readonly isOutgoing: boolean;
	readonly isDeleted: boolean;
}
