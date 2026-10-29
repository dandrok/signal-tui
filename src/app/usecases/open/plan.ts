import type { ConversationId, Message } from "../../../domain/types";
import { type OpenFile, openCandidates, rowRefusal } from "./candidates";
import type { OpenContext } from "./context";
import { inAttachmentsDir } from "./root";

/**
 * Opening a file someone sent, once the disk has a vote.
 *
 * Two questions, both pure over the injected context: *what does this row offer* (`openFiles` —
 * the list the picker shows, with each entry checked against the filesystem) and *may this one
 * launch* (`openPlan` — re-checked at the moment it launches, because a row can be swept, a file
 * deleted and a symlink swapped between the keystroke and the confirm).
 */

/** What `o` on a row offers: the files it can open, or the sentence that says why none. */
export type OpenList =
	| { readonly kind: "listed"; readonly files: readonly OpenFile[] }
	| { readonly kind: "refused"; readonly reason: string };

/** What launching one file does: the launch, or the sentence that says why there is none. */
export type OpenPlan =
	| { readonly kind: "open"; readonly file: OpenFile }
	| { readonly kind: "refused"; readonly reason: string };

/** What the status line says once a file has been handed to the desktop. */
export function openNotice(file: OpenFile): string {
	return `opened ${file.name}`;
}

/**
 * What `o` on this row offers, with each candidate checked against the disk.
 *
 * A file whose text says yes but whose file is gone, outside the directory or a folder is dropped
 * rather than offered — the picker must not list something the confirm would then refuse. When
 * nothing survives, the first reason is the answer: it is the one the row leads with.
 */
export function openFiles(
	message: Message | undefined,
	conversationId: ConversationId,
	context: OpenContext,
): OpenList {
	const refusal = rowRefusal(message, conversationId);
	if (refusal !== null || message === undefined) {
		return { kind: "refused", reason: refusal ?? "that message is gone: nothing to open" };
	}
	if ((message.attachments?.length ?? 0) === 0) {
		return { kind: "refused", reason: "that message has no file" };
	}
	const candidates = openCandidates(message, context.root);
	if (candidates.length === 0) {
		return { kind: "refused", reason: "the engine kept no copy of that file: nothing to open" };
	}
	const files: OpenFile[] = [];
	let firstFailure: string | null = null;
	for (const candidate of candidates) {
		const plan = openPlan(candidate, context);
		if (plan.kind === "refused") {
			firstFailure ??= plan.reason;
			continue;
		}
		files.push(plan.file);
	}
	return files.length > 0
		? { kind: "listed", files }
		: { kind: "refused", reason: firstFailure ?? "that file is no longer on disk" };
}

/**
 * Launching one file, re-checked at the moment it is launched.
 *
 * The directory rule comes before the filesystem: a path outside the engine's folder is refused on
 * its text alone, without a stat, so nothing a peer named is probed for existence. Then the
 * canonical path — `realpath`, because a symlink inside the directory can point out of it — is
 * what goes to the opener, and it is checked against the canonical root for the same reason.
 *
 * Takes a candidate rather than a message: the picker froze the list when `o` was pressed, and the
 * freeze rule is the point — `⏎` opens the row that is highlighted, not whichever file a re-read
 * of the row would now produce.
 */
export function openPlan(file: OpenFile, context: OpenContext): OpenPlan {
	const base = context.fs.realPath(context.root) ?? context.root;
	if (!inAttachmentsDir(file.path, context.root) && !inAttachmentsDir(file.path, base)) {
		return {
			kind: "refused",
			reason: `${file.name} is outside the engine's attachments folder: not opening it`,
		};
	}
	const real = context.fs.realPath(file.path);
	if (real === null) {
		return { kind: "refused", reason: `${file.name} is no longer on disk` };
	}
	if (!inAttachmentsDir(real, base)) {
		return {
			kind: "refused",
			reason: `${file.name} points outside the engine's attachments folder: not opening it`,
		};
	}
	if (!context.fs.isFile(real)) {
		return { kind: "refused", reason: `${file.name} is a folder, not a file` };
	}
	return { kind: "open", file: { path: real, name: file.name } };
}
