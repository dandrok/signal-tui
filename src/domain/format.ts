import { displayLine, displayText } from "./display";
import { reactionMarker } from "./reactions";
import { receiptMarker } from "./receipts";
import type { Attachment, Conversation, Message } from "./types";

/**
 * The strings a message row is made of.
 *
 * Measurement lives in `layout.ts` and composes nothing of its own: it calls these, so what
 * a pane budgets is what it draws. Splitting the two by responsibility is what keeps a
 * marker from being counted in one place and composed in another.
 */

/**
 * Renders a timestamp as a clock string. Injected rather than computed here: the
 * host timezone is a UI concern, and a formatter cache is mutable state that has
 * no business in the domain layer.
 */
export type Clock = (timestampMs: number) => string;

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

/**
 * Who to show above a message body, with terminal directives removed: an author
 * name is drawn on one row, so a name cannot smuggle in colour or a line break.
 */
export function describeAuthor(message: Message): string {
	if (message.isDeleted) {
		return "deleted";
	}
	return message.isOutgoing ? SELF_LABEL : displayLine(message.author);
}

/** Body text safe to render, honouring deletions. */
export function describeBody(message: Message): string {
	if (message.isDeleted) {
		return "message deleted";
	}
	// A view-once message was never cached, so there is nothing to recover — say what
	// arrived instead of drawing an empty row.
	if (message.isViewOnce === true) {
		return VIEW_ONCE_BODY;
	}
	// The body is already empty by the time this renders; the label is what tells a
	// reader the message was there and is not something they can recover.
	return message.isExpired === true ? "message expired" : displayText(message.body);
}

/** What a view-once message says instead of its content, which was never stored. */
export const VIEW_ONCE_BODY = "view-once message · not stored";

/**
 * Stand-in body for a message that carried only files.
 */
export const ATTACHMENT_BODY_PLACEHOLDER = "[attachment]";

/** Whether the body line is worth a row of its own. */
export function showsBody(message: Message): boolean {
	if (message.isDeleted) {
		return true;
	}
	// The view-once notice is the whole content of the row, so it always gets a line.
	if (message.isViewOnce === true) {
		return true;
	}
	const attachments = attachmentsOf(message);
	return (
		message.body.length > 0 &&
		!(attachments.length > 0 && message.body === ATTACHMENT_BODY_PLACEHOLDER)
	);
}

/**
 * Suffix that marks a corrected message. The marker belongs to the header rather
 * than to the body: appended to the body it would read as the sender's text, and
 * on its own row it would cost a row of the window for every edited message.
 *
 * The renderer and the row measurement both call this, so what is measured is
 * what is drawn.
 */
export const editedMarker = (message: Message): string =>
	message.isEdited === true ? " · edited" : "";

/**
 * Everything drawn after the author on a message's first row: corrected, delivered,
 * reacted. One composer, because the row is measured from `headerLine` and drawn from
 * the same pieces — two copies is how a marker ends up measured but not drawn, or the
 * other way round.
 */
export function headerSuffix(message: Message): string {
	return `${editedMarker(message)}${receiptMarker(message)}${reactionMarker(message)}`;
}

/**
 * The author row exactly as the pane draws it: optional marker, clock, space, author label.
 * The marker is part of the string the row is measured from, so a cursor cannot cost a row
 * the window never budgeted.
 */
export function headerLine(message: Message, clock: Clock, marker = ""): string {
	return `${marker}${clock(message.sentAt)} ${describeAuthor(message)}${headerSuffix(message)}`;
}

/** One attachment exactly as the pane draws it. */
export function attachmentLine(attachment: Attachment): string {
	return `📎 ${describeAttachment(attachment)}`;
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
	const name = displayLine(path.split("/").pop() ?? "");
	const label =
		name.length > 0
			? name
			: attachment.isVoiceNote
				? "voice note"
				: displayLine(attachment.contentType ?? "attachment");
	const size = attachment.size === null ? "" : ` (${formatBytes(attachment.size)})`;
	return `${label}${size}`;
}

/**
 * Label for a conversation. A sync transcript only carries the destination id, so
 * a conversation you have never received from has no name yet: show the id rather
 * than an empty row.
 */
export function displayName(conversation: Conversation): string {
	// A group name comes from whoever administers the group: same rule as an author.
	const name = displayLine(conversation.name);
	return name.length > 0 ? name : conversation.id;
}
