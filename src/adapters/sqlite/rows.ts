import type { Conversation, Message } from "../../domain/types";

export interface MessageRow {
	id: string;
	conversation_id: string;
	author: string;
	author_id: string | null;
	body: string;
	sent_at: number;
	is_outgoing: number;
	is_deleted: number;
	is_edited: number;
	expires_at: number | null;
	is_expired: number;
}

export interface ConversationRow {
	id: string;
	name: string;
	unread_count: number;
	last_activity_at: number;
	expires_in_seconds: number | null;
}

export function toMessage(row: MessageRow): Message {
	return {
		id: row.id,
		conversationId: row.conversation_id,
		author: row.author,
		...(row.author_id === null ? {} : { authorId: row.author_id }),
		body: row.body,
		sentAt: row.sent_at,
		isOutgoing: row.is_outgoing === 1,
		isDeleted: row.is_deleted === 1,
		isEdited: row.is_edited === 1,
		...(row.expires_at === null ? {} : { expiresAt: row.expires_at }),
		...(row.is_expired === 1 ? { isExpired: true } : {}),
	};
}

export function toConversation(row: ConversationRow): Conversation {
	return {
		id: row.id,
		name: row.name,
		unreadCount: row.unread_count,
		lastActivityAt: row.last_activity_at,
		...(row.expires_in_seconds === null ? {} : { expiresInSeconds: row.expires_in_seconds }),
	};
}
