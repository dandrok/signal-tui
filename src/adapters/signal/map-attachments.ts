import type { Attachment } from "../../domain/types";

/**
 * One file from the wire. Everything is optional in signal-cli's output, so each
 * field is narrowed rather than trusted; a null entry (older releases send those)
 * is dropped by the caller.
 */
function toAttachment(raw: unknown): Attachment | null {
	if (raw === null || typeof raw !== "object") {
		return null;
	}
	const entry = raw as Record<string, unknown>;
	const text = (value: unknown): string | null => (typeof value === "string" ? value : null);
	return {
		id: text(entry.id),
		contentType: text(entry.contentType),
		filename: text(entry.filename),
		size: typeof entry.size === "number" && Number.isFinite(entry.size) ? entry.size : null,
		caption: text(entry.caption),
		isVoiceNote: entry.isVoiceNote === true,
	};
}

/**
 * Files carried by a message, in the order signal-cli listed them. Split out of the
 * envelope mapper because files have their own shape (`JsonAttachment` vs
 * `JsonQuotedAttachment`) and their own rules: every field can be null, and an
 * entry that is not an object at all is dropped rather than failing the message.
 */
export function mapAttachments(raw: readonly unknown[] | undefined): readonly Attachment[] {
	return (raw ?? []).map(toAttachment).filter((entry): entry is Attachment => entry !== null);
}
