import { basename, isAbsolute, join } from "node:path";
import type { Attachment, ConversationId, Message } from "../../../domain/types";
import type { OpenContext } from "./context";
import { inAttachmentsDir } from "./root";

/**
 * Opening a file someone sent: which path a row would launch, and the sentence that says why
 * there is none.
 *
 * Pure over the injected context — the verdict is a value, so the key, the confirm prompt and
 * the status line all read the same answer. Nothing here launches anything: the wiring does
 * that, once, after this says it is allowed.
 *
 * **The local file is the attachment's `id`, not its `filename`.** `signal-cli` writes what it
 * downloads as `<data-dir>/attachments/<id>` — the id carries the extension — and reports the
 * original name separately as `filename`, for display. Reading `filename` as a path is what made
 * the first version refuse every real attachment ("signal-2026-…​.jpeg is outside the engine's
 * attachments folder"): the name was right there on the row, and it named nothing on disk.
 * Checked against a real cache: 32 rows, 30 with an id, all 30 present at `<root>/<id>`, all 30
 * sizes matching.
 */

/** The file a launched row would open. */
export interface OpenFile {
	/** The canonical path that goes to the opener — never the one the row was drawn from. */
	readonly path: string;
	/** The last segment, for the notice: what the user sees beside the row. */
	readonly name: string;
}

/** What a confirmed `o` does: the launch, or the sentence that says why there is none. */
export type OpenPlan =
	| { readonly kind: "open"; readonly file: OpenFile }
	| { readonly kind: "refused"; readonly reason: string };

/**
 * The name the engine gave the downloaded file, or null when this attachment was not kept.
 *
 * A bare name only. The id comes off the wire, so it is treated as a component and never as a
 * path: anything with a separator or a `.`/`..` in it is not something the engine writes, and
 * joining it would let a peer name a file outside the directory. Null is the `ignoreAttachments`
 * case, and our own sends — the engine uploaded those and kept no local copy.
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

/** A file a row could open: where it is, and what to call it. */
export interface OpenCandidate {
	/** Where the engine wrote it, built from the directory and the attachment's id. */
	readonly path: string;
	/**
	 * What the user sees: the name the sender gave the file, which is what the row draws, falling
	 * back to the engine's own name when the sender gave none. Never used as a path.
	 */
	readonly name: string;
}

/**
 * The file a row would open, or null when the engine kept no copy.
 *
 * The first attachment that has an id — a row with several is rare, and the one the pane draws
 * first is the one a keystroke reads as "this file". A file with no id is skipped rather than
 * ending the search, because a message can carry a file the engine did not download beside one it
 * did.
 *
 * An absolute `filename` inside the directory is accepted too, and only there: that is an engine
 * reporting the path it wrote rather than the name it was sent. The directory check is the same
 * one the launch gets, so this cannot widen what `o` may reach.
 */
export function openCandidate(message: Message, root: string): OpenCandidate | null {
	for (const attachment of message.attachments ?? []) {
		const id = localName(attachment);
		const path = id === null ? absoluteInside(attachment.filename, root) : join(root, id);
		if (path !== null) {
			const name = attachment.filename;
			return { path, name: typeof name === "string" && name.length > 0 ? name : basename(path) };
		}
	}
	return null;
}

/** `filename` as a path, but only when the engine wrote one and it is in its own directory. */
function absoluteInside(filename: string | null, root: string): string | null {
	// A name is not a path: `photo.jpg` is what a sender called the file, and joining it would be
	// the bug this slice shipped with.
	return typeof filename === "string" && isAbsolute(filename) && inAttachmentsDir(filename, root)
		? filename
		: null;
}

/** What the status line says once a file has been handed to the desktop. */
export function openNotice(file: OpenFile): string {
	return `opened ${file.name}`;
}

/**
 * What `o` on this row would do.
 *
 * The refusals are ordered by what the user can act on. A deleted, expired or view-once row has
 * no file at all, so saying that is truer than saying the path is missing. The directory rule
 * comes before the filesystem: a path outside the engine's folder is refused on its text alone,
 * without a stat, so nothing a peer named can even be probed for existence.
 *
 * The launch path is the *canonical* one — `realpath` of a file that lives under a symlinked
 * attachments directory — and it is checked against the canonical root for the same reason: the
 * text of a path says where it claims to be, and the kernel disagrees often enough to matter.
 */
export function openPlan(
	message: Message | undefined,
	conversationId: ConversationId,
	context: OpenContext,
): OpenPlan {
	if (message === undefined) {
		return { kind: "refused", reason: "that message is gone: nothing to open" };
	}
	if (message.conversationId !== conversationId) {
		return { kind: "refused", reason: "that message is not in this conversation" };
	}
	if (message.isDeleted) {
		return { kind: "refused", reason: "that message was deleted: nothing to open" };
	}
	if (message.isExpired === true) {
		return { kind: "refused", reason: "that message expired: its file is gone" };
	}
	if (message.isViewOnce === true) {
		return { kind: "refused", reason: "a view-once file was never stored: nothing to open" };
	}
	const candidate = openCandidate(message, context.root);
	if (candidate === null) {
		const count = message.attachments?.length ?? 0;
		return {
			kind: "refused",
			reason:
				count === 0
					? "that message has no file"
					: "the engine kept no copy of that file: nothing to open",
		};
	}
	const named = candidate.path;
	// The canonical root, because `$XDG_DATA_HOME` is allowed to be a symlink and the engine
	// then writes through it: a file can be inside the *place* while its text names the real
	// directory. Both spellings are checked on the way in; the real one on the way out.
	const base = context.fs.realPath(context.root) ?? context.root;
	if (!inAttachmentsDir(named, context.root) && !inAttachmentsDir(named, base)) {
		return {
			kind: "refused",
			reason: `${candidate.name} is outside the engine's attachments folder: not opening it`,
		};
	}
	const real = context.fs.realPath(named);
	if (real === null) {
		return { kind: "refused", reason: `${candidate.name} is no longer on disk` };
	}
	if (!inAttachmentsDir(real, base)) {
		return {
			kind: "refused",
			reason: `${candidate.name} points outside the engine's attachments folder: not opening it`,
		};
	}
	if (!context.fs.isFile(real)) {
		return { kind: "refused", reason: `${candidate.name} is a folder, not a file` };
	}
	return { kind: "open", file: { path: real, name: candidate.name } };
}

/**
 * Whether `o` would open this row's file — what the status line advertises with.
 *
 * The text of the path only: the status line is drawn on every keystroke and must not stat the
 * disk for a hint. A file that vanished since is refused by `openPlan` when the key is pressed,
 * which is the moment the user can be told.
 */
export function canOpen(message: Message, root: string): boolean {
	return openCandidate(message, root) !== null;
}
