import { basename, join } from "node:path";
import { type AttachContext, draftSplit } from "./listing";

/**
 * What a confirmed path becomes — the second half of the attach use case, split from the
 * listing because the two answer different questions: *what can I pick* (a directory read) and
 * *what happens if I pick this* (a stat and a verdict). Both are pure over the injected
 * filesystem, and the wiring calls one on every keystroke and the other once, on `⏎`.
 */

/** Signal's own ceiling; the engine is the authority, but refusing before a 200 MB upload is kinder. */
export const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;

/** What a confirmed path becomes, or the sentence that says why it cannot. */
export type AttachPlan =
	| {
			readonly kind: "send";
			readonly file: { readonly path: string; readonly name: string; readonly size: number };
	  }
	| { readonly kind: "refused"; readonly reason: string };

/** What the status line says once a file has gone out. */
export function attachNotice(file: { readonly name: string }): string {
	return `sent ${file.name}`;
}

/**
 * What a confirmed draft becomes.
 *
 * A directory is refused here rather than sent: the prompt descends into one, so reaching this
 * point with a directory means the draft was typed rather than picked, and sending a folder is
 * not a thing the wire can carry. An empty file is refused for the same kind of reason — it
 * would arrive as a message that looks broken, and the user cannot tell why.
 */
export function attachPlan(draft: string, context: AttachContext): AttachPlan {
	const trimmed = draft.trim();
	if (trimmed.length === 0) {
		return { kind: "refused", reason: "type a path, or pick one from the list" };
	}
	const { directory, filter } = draftSplit(trimmed, context);
	const path = filter.length === 0 ? directory : join(directory, filter);

	let size: number | null;
	try {
		size = context.fs.sizeOf(path);
	} catch {
		return { kind: "refused", reason: `nothing at ${path}` };
	}
	if (size === null) {
		return { kind: "refused", reason: `${path} is a directory: pick a file inside it` };
	}
	if (size === 0) {
		return { kind: "refused", reason: `${basename(path)} is empty` };
	}
	if (size > MAX_ATTACHMENT_BYTES) {
		return {
			kind: "refused",
			reason: `${basename(path)} is ${Math.round(size / (1024 * 1024))} MB: Signal refuses more than 100 MB`,
		};
	}
	return { kind: "send", file: { path, name: basename(path), size } };
}
