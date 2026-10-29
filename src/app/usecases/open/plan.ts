import { basename } from "node:path";
import type { Attachment, ConversationId, Message } from "../../../domain/types";
import { inAttachmentsDir, type OpenContext } from "./context";

/**
 * Opening a file someone sent: which path a row would launch, and the sentence that says why
 * there is none.
 *
 * Pure over the injected context — the verdict is a value, so the key, the confirm prompt and
 * the status line all read the same answer. Nothing here launches anything: the wiring does
 * that, once, after this says it is allowed.
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
 * The first file on a message that the engine actually downloaded, or null.
 *
 * The first rather than a picker: a row with several files is rare, and the one the pane draws
 * first is the one a keystroke reads as "this file". A file with no path is skipped rather than
 * ending the search — with `ignoreAttachments` the engine reports the files it did not keep, so
 * a message can carry one of those beside one that arrived.
 */
function firstDownloaded(message: Message): string | null {
	const files: readonly Attachment[] = message.attachments ?? [];
	for (const file of files) {
		if (typeof file.filename === "string" && file.filename.length > 0) {
			return file.filename;
		}
	}
	return null;
}

/** Whether the row's first file is one the engine downloaded — the cheap half of the rule. */
export function downloadedPath(message: Message): string | null {
	return firstDownloaded(message);
}

/** What the status line says once a file has been handed to the desktop. */
export function openNotice(file: OpenFile): string {
	return `opened ${file.name}`;
}

/**
 * What `o` on this row would do.
 *
 * The refusals are ordered by what the user can act on. A deleted, expired or view-once row has
 * no file at all, so saying that is truer than saying the path is missing. The security rule
 * comes before the filesystem: a path outside the engine's directory is refused on its text
 * alone, without a stat, so nothing a peer named can even be probed for existence.
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
	const named = firstDownloaded(message);
	if (named === null) {
		const count = message.attachments?.length ?? 0;
		return {
			kind: "refused",
			reason:
				count === 0
					? "that message has no file"
					: "that file was not downloaded, so there is nothing to open",
		};
	}
	// The canonical root, because `$XDG_DATA_HOME` is allowed to be a symlink and the engine
	// then writes through it: a file can be inside the *place* while its text names the real
	// directory. Both spellings count on the way in; the real one is what the launch is checked
	// against on the way out.
	const base = context.fs.realPath(context.root) ?? context.root;
	if (!inAttachmentsDir(named, context.root) && !inAttachmentsDir(named, base)) {
		return {
			kind: "refused",
			reason: `${basename(named)} is outside the engine's attachments folder: not opening it`,
		};
	}
	const real = context.fs.realPath(named);
	if (real === null) {
		return { kind: "refused", reason: `${basename(named)} is no longer on disk` };
	}
	if (!inAttachmentsDir(real, base)) {
		return {
			kind: "refused",
			reason: `${basename(named)} points outside the engine's attachments folder: not opening it`,
		};
	}
	if (!context.fs.isFile(real)) {
		return { kind: "refused", reason: `${basename(real)} is a folder, not a file` };
	}
	return { kind: "open", file: { path: real, name: basename(real) } };
}

/**
 * Whether `o` would open this row's file — what the status line advertises with.
 *
 * The text of the path only: the status line is drawn on every keystroke and must not stat the
 * disk for a hint. A file that vanished since is refused by `openPlan` when the key is pressed,
 * which is the moment the user can be told.
 */
export function canOpen(message: Message, root: string): boolean {
	const named = downloadedPath(message);
	return named !== null && inAttachmentsDir(named, root);
}
