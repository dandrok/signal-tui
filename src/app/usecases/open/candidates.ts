import { basename, isAbsolute, join } from "node:path";
import type { Attachment, ConversationId, Message } from "../../../domain/types";
import { inAttachmentsDir } from "./root";

/**
 * What a row's files are: the ones the engine kept, and what to call them.
 *
 * Text only — no disk — because two callers need an answer on every keystroke: the status line,
 * which decides whether to advertise `o` at all, and the key itself, which builds the list the
 * picker shows. `plan.ts` is the same list after the filesystem has agreed with each entry.
 *
 * **The local file is the attachment's `id`, not its `filename`.** `signal-cli` writes what it
 * downloads as `<data-dir>/attachments/<id>` — the id carries the extension — and reports the
 * original name separately as `filename`, for display. Reading `filename` as a path is what made
 * the first version refuse every live attachment ("signal-2026-…​.jpeg is outside the engine's
 * attachments folder"): the name was right there on the row, and it named nothing on disk.
 * Checked against a real cache: 32 rows, 30 with an id, all 30 present at `<root>/<id>`, all 30
 * sizes matching.
 */

/** A file a row offers to open. */
export interface OpenFile {
	/** Where the engine wrote it: the directory plus the attachment's id. Never the display name. */
	readonly path: string;
	/** What the user sees — the name the sender gave it, or the engine's own when there is none. */
	readonly name: string;
}

/**
 * Why the row itself cannot be opened, whatever it carries.
 *
 * A deleted, expired or view-once row has no file at all, so saying that is truer than anything
 * about a path — and all three are checked before the files, because the answer to "where is it"
 * is "there is nothing left to be somewhere".
 */
export function rowRefusal(
	message: Message | undefined,
	conversationId: ConversationId,
): string | null {
	if (message === undefined) {
		return "that message is gone: nothing to open";
	}
	if (message.conversationId !== conversationId) {
		return "that message is not in this conversation";
	}
	if (message.isDeleted) {
		return "that message was deleted: nothing to open";
	}
	if (message.isExpired === true) {
		return "that message expired: its file is gone";
	}
	if (message.isViewOnce === true) {
		return "a view-once file was never stored: nothing to open";
	}
	return null;
}

/**
 * The name the engine gave the downloaded file, or null when this attachment was not kept.
 *
 * A bare name only. The id comes off the wire, so it is treated as a component and never as a
 * path: a separator or a `.`/`..` in it is not something the engine writes, and joining it would
 * let a peer name a file outside the directory. Null is the `ignoreAttachments` case, and our own
 * sends — the engine uploaded those and kept no local copy.
 */
function localName(attachment: Attachment): string | null {
	const id = attachment.id;
	if (typeof id !== "string" || id.length === 0 || id === "." || id === "..") {
		return null;
	}
	if (id.includes("/") || id.includes("\\") || basename(id) !== id) {
		return null;
	}
	return id;
}

/**
 * Where this attachment would be, by its text alone.
 *
 * The id is the file's name; an absolute `filename` inside the directory is accepted as well, and
 * only there, for an engine that reports the path it wrote rather than the name it was sent.
 */
function candidateFor(attachment: Attachment, root: string): OpenFile | null {
	const id = localName(attachment);
	const named = attachment.filename;
	const path =
		id !== null
			? join(root, id)
			: typeof named === "string" && isAbsolute(named) && inAttachmentsDir(named, root)
				? named
				: null;
	if (path === null) {
		return null;
	}
	return { path, name: typeof named === "string" && named.length > 0 ? named : basename(path) };
}

/**
 * The files a row offers, in the order the pane draws them — every one, not just the first.
 *
 * A message can carry four files, and the pane draws four lines, so a key that opened whichever
 * one came first would be a silent choice on the user's behalf. This list is what the picker
 * shows.
 */
export function openCandidates(message: Message, root: string): readonly OpenFile[] {
	const files: OpenFile[] = [];
	for (const attachment of message.attachments ?? []) {
		const candidate = candidateFor(attachment, root);
		if (candidate !== null) {
			files.push(candidate);
		}
	}
	return files;
}

/**
 * Whether `o` would offer anything on this row — what the status line advertises with.
 *
 * The text only: the line is drawn on every keystroke and must not stat the disk for a hint. A
 * file that vanished since is dropped by `openFiles` when the key is pressed, which is the moment
 * the user can be told.
 */
export function canOpen(message: Message, root: string): boolean {
	return openCandidates(message, root).length > 0;
}
