import { ATTACHMENT_BODY_PLACEHOLDER } from "../../domain/format";

/**
 * The text and the timer of a data message, read from signal-cli's shape.
 *
 * Split out of the envelope mapper because two callers need the same rules: a new
 * message takes its body from here, and an edit may only take text — never the
 * `[attachment]` stand-in — so a correction can never paste a placeholder over what
 * a peer actually wrote.
 */
interface Textual {
	readonly message?: string | null | undefined;
	readonly expiresInSeconds?: number | null | undefined;
	readonly attachments?: readonly unknown[] | undefined;
}

const ATTACHMENT_PLACEHOLDER = ATTACHMENT_BODY_PLACEHOLDER;

/**
 * The moment a disappearing message is due to go. Signal's timer counts from when
 * the message was sent, and a conversation without a timer reports nothing — or a
 * zero, which is how an off timer arrives.
 */
export const expiresAtOf = (data: Textual & { readonly timestamp: number }): number | undefined => {
	const seconds = data.expiresInSeconds;
	if (seconds === undefined || seconds === null || seconds <= 0) {
		return undefined;
	}
	return data.timestamp + seconds * 1000;
};

/** Caption of the first file that has one; signal-cli keeps it there, not in `message`. */
const captionOf = (data: Textual): string | null => {
	for (const raw of data.attachments ?? []) {
		const caption = (raw as { caption?: unknown } | null)?.caption;
		if (typeof caption === "string" && caption.length > 0) {
			return caption;
		}
	}
	return null;
};

/** The text a message actually carries: its body, or a file's caption. */
/** The text a message actually carries: its body, or a file's caption. */
export const textOf = (data: Textual): string => {
	if (data.message !== undefined && data.message !== null && data.message.length > 0) {
		return data.message;
	}
	// A photo sent with text puts that text in the attachment's caption, so without
	// this the message would show only a filename. It also keeps captions searchable.
	return captionOf(data) ?? "";
};

export const bodyOf = (data: Textual): string => {
	const text = textOf(data);
	if (text.length > 0) {
		return text;
	}
	// Files with no text at all still deserve a row of their own.
	return (data.attachments?.length ?? 0) > 0 ? ATTACHMENT_PLACEHOLDER : "";
};
