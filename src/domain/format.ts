import type { Conversation, Message } from "./types";

/** Two-digit 24h clock in the local timezone, e.g. 09:04. */
export function formatClock(timestampMs: number): string {
	const date = new Date(timestampMs);
	const hours = String(date.getHours()).padStart(2, "0");
	const minutes = String(date.getMinutes()).padStart(2, "0");
	return `${hours}:${minutes}`;
}

/** Unread badge text: empty for none, capped at 99+. */
export function formatUnread(count: number): string {
	if (count <= 0) {
		return "";
	}
	return count > 99 ? "99+" : String(count);
}

/** Hard-truncate to width, adding an ellipsis when something was cut. */
export function truncate(text: string, width: number): string {
	if (width <= 0) {
		return "";
	}
	if (text.length <= width) {
		return text;
	}
	return width === 1 ? "…" : `${text.slice(0, width - 1)}…`;
}

/** Author label for messages you sent, wherever they are rendered. */
export const SELF_LABEL = "You";

/** Who to show above a message body. */
export function describeAuthor(message: Message): string {
	if (message.isDeleted) {
		return "deleted";
	}
	return message.isOutgoing ? SELF_LABEL : message.author;
}

/** Body text safe to render, honouring deletions. */
export function describeBody(message: Message): string {
	return message.isDeleted ? "message deleted" : message.body;
}

/**
 * Label for a conversation. A sync transcript only carries the destination id, so
 * a conversation you have never received from has no name yet: show the id rather
 * than an empty row.
 */
export function displayName(conversation: Conversation): string {
	const name = conversation.name.trim();
	return name.length > 0 ? name : conversation.id;
}
