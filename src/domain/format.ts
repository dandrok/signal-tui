import wrapAnsi from "wrap-ansi";
import type { Attachment, Conversation, Message } from "./types";

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
 * Stand-in body for a message that carried only files.
 */
export const ATTACHMENT_BODY_PLACEHOLDER = "[attachment]";

/** Whether the body line is worth a row of its own. */
export function showsBody(message: Message): boolean {
	if (message.isDeleted) {
		return true;
	}
	const attachments = attachmentsOf(message);
	return (
		message.body.length > 0 &&
		!(attachments.length > 0 && message.body === ATTACHMENT_BODY_PLACEHOLDER)
	);
}

/**
 * Rows a message occupies in a pane whose text area is `innerWidth` columns:
 * one for the author line, the wrapped body, and one per file. The message pane
 * fits a window in rows, so counting messages instead of rows silently clips the
 * newest ones — and those are the ones being read.
 *
 * Wrapping is delegated to the same options ink uses for `<Text>`, because a
 * hand-rolled `length / width` gets both explicit newlines and wide characters
 * (CJK, emoji) wrong, and a window that over-selects hides the newest message.
 */
export function messageRowCount(message: Message, innerWidth: number, maxRows = 60): number {
	const width = Math.max(1, innerWidth);
	const rows = Math.max(1, maxRows);
	// Only the first `rows * width` cells can add rows to a window that is at most
	// `rows` tall; measuring further would let one pathological body — the wire
	// allows up to 8 MiB — stall a render for no gain.
	const body = describeBody(message).slice(0, rows * width);
	const bodyRows = showsBody(message) ? Math.min(rows, wrappedRows(body, width)) : 0;
	const fileRows = message.isDeleted ? 0 : attachmentsOf(message).length;
	return 1 + bodyRows + fileRows;
}

/** The options ink's own `wrap` mode uses; matching them keeps the count honest. */
const WRAP = { trim: false, hard: true } as const;

/** Rows `text` occupies when rendered into `width` cells. */
function wrappedRows(text: string, width: number): number {
	return wrapAnsi(text, width, WRAP).split("\n").length;
}

/** The end of a draft that fits one row, so the cursor is never scrolled away. */
export interface DraftTail {
	/** Text of the last wrapped line. */
	readonly text: string;
	/** True when earlier lines were dropped, so the caller can say so. */
	readonly truncated: boolean;
}

export function draftTail(draft: string, width: number): DraftTail {
	const lines = wrapAnsi(draft, Math.max(1, width), WRAP).split("\n");
	return { text: lines[lines.length - 1] ?? "", truncated: lines.length > 1 };
}

/** Attachments of a message, without every caller repeating `?? []`. */
export function attachmentsOf(message: Message): readonly Attachment[] {
	return message.attachments ?? [];
}

/** 1536 → "1.5 KB", 4096 → "4.0 KB", 5242880 → "5.0 MB". */
export function formatBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes < 0) {
		return "";
	}
	if (bytes < 1024) {
		return `${bytes} B`;
	}
	const units = ["KB", "MB", "GB", "TB"];
	let value = bytes / 1024;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit += 1;
	}
	return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/**
 * One attachment as a single readable line. signal-cli reports the downloaded
 * path, so the label shows the last segment; a file with no name falls back to
 * its type, and a voice note says what it is.
 */
export function describeAttachment(attachment: Attachment): string {
	const path = attachment.filename ?? "";
	const name = path.split("/").pop() ?? "";
	const label =
		name.length > 0
			? name
			: attachment.isVoiceNote
				? "voice note"
				: (attachment.contentType ?? "attachment");
	const size = attachment.size === null ? "" : ` (${formatBytes(attachment.size)})`;
	return `${label}${size}`;
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
