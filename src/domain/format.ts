import wrapAnsi from "wrap-ansi";
import type { Attachment, Conversation, Message } from "./types";

/**
 * Two-digit 24h clock in an explicit timezone, e.g. 09:04. The zone is a
 * parameter because this lives in the domain: a helper that reads the host
 * timezone renders differently on every machine and cannot be tested.
 */
export function formatClock(timestampMs: number, timeZone: string): string {
	return clockFormatter(timeZone).format(timestampMs);
}

/** One formatter per zone; `Intl.DateTimeFormat` construction is the costly part. */
const clockFormatters = new Map<string, Intl.DateTimeFormat>();

function clockFormatter(timeZone: string): Intl.DateTimeFormat {
	const cached = clockFormatters.get(timeZone);
	if (cached !== undefined) {
		return cached;
	}
	const formatter = new Intl.DateTimeFormat("en-GB", {
		timeZone,
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	});
	clockFormatters.set(timeZone, formatter);
	return formatter;
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
 * The author row exactly as the pane draws it: clock, space, author label. Kept
 * here so the row count measures the string that actually gets rendered.
 */
export function headerLine(message: Message, timeZone: string): string {
	return `${formatClock(message.sentAt, timeZone)} ${describeAuthor(message)}`;
}

/** One attachment exactly as the pane draws it. */
export function attachmentLine(attachment: Attachment): string {
	return `📎 ${describeAttachment(attachment)}`;
}

/**
 * Rows a message spends before its body: the header (a long author name wraps)
 * and one line per file (filenames wrap too). The body gets what is left, so an
 * oversized body cannot push its own attachments out of the pane.
 */
export function messageOverheadRows(
	message: Message,
	innerWidth: number,
	timeZone: string,
): number {
	const width = Math.max(1, innerWidth);
	const header = wrappedRows(headerLine(message, timeZone), width);
	const files = message.isDeleted
		? 0
		: attachmentsOf(message).reduce(
				(total, attachment) => total + wrappedRows(attachmentLine(attachment), width),
				0,
			);
	return header + files;
}

/**
 * Rows a message occupies in a pane whose text area is `innerWidth` columns:
 * overhead plus the body, never more than the pane itself. The message pane fits
 * a window in rows, so counting messages instead of rows silently clips the
 * newest ones — and those are the ones being read.
 *
 * Wrapping is delegated to the same options ink uses for `<Text>`, because a
 * hand-rolled `length / width` gets explicit newlines and wide characters (CJK,
 * emoji) wrong, and a window that over-selects hides the newest message.
 */
export function messageRowCount(
	message: Message,
	innerWidth: number,
	timeZone: string,
	maxRows = 60,
): number {
	const rows = Math.max(1, maxRows);
	const overhead = messageOverheadRows(message, innerWidth, timeZone);
	const budget = Math.max(0, rows - overhead);
	const body = showsBody(message) ? bodyForDisplay(message, budget, innerWidth) : { rows: 0 };
	return Math.min(rows, overhead + body.rows);
}

/** What the pane draws for a body, and where it stops. */
export interface DisplayBody {
	readonly text: string;
	readonly truncated: boolean;
	/** Rows the text actually occupies, so callers can budget around it. */
	readonly rows: number;
}

/**
 * Body text cut to `maxRows` wrapped rows. Counting characters is not enough: a
 * body of nothing but newlines fits any character budget and still renders one
 * row per newline, and a wide character costs two cells. The text is bounded
 * before wrapping — only the first `rows * width` characters can fill `rows` rows
 * at one cell each — so the work stays proportional to what is drawn.
 *
 * The cut is shown rather than hidden, and the marker takes the last row of the
 * budget; a single-row budget has no room for it. The rest of a very long message
 * is not reachable until the pane can scroll by line instead of by message.
 */
export function bodyForDisplay(message: Message, maxRows: number, innerWidth: number): DisplayBody {
	const width = Math.max(1, innerWidth);
	const rows = Math.max(0, maxRows);
	const full = describeBody(message);
	if (rows === 0) {
		return { text: "", truncated: full.length > 0, rows: 0 };
	}
	const bounded = full.slice(0, rows * width);
	const lines = wrapAnsi(bounded, width, WRAP).split("\n");
	if (bounded.length === full.length && lines.length <= rows) {
		return { text: lines.join("\n"), truncated: false, rows: lines.length };
	}
	const kept = rows === 1 ? [lines[0] ?? "…"] : [...lines.slice(0, rows - 1), "…"];
	return { text: kept.join("\n"), truncated: true, rows: kept.length };
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

/**
 * Chars examined from the end of a draft. Two lines' worth is enough to find the
 * last line break, and it keeps the work per keystroke bounded: wrapping is O(n),
 * and a pasted message is n = its whole length on every character typed.
 */
const TAIL_WINDOW = 2;

export function draftTail(draft: string, width: number): DraftTail {
	const cells = Math.max(1, width);
	const limit = Math.max(1, cells * TAIL_WINDOW);
	const cut = draft.length > limit;
	const lines = wrapAnsi(cut ? draft.slice(-limit) : draft, cells, WRAP).split("\n");
	return { text: lines[lines.length - 1] ?? "", truncated: cut || lines.length > 1 };
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
