import { readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";

/**
 * Sending a file: what the path prompt lists, and where a draft points.
 *
 * The filesystem is the one source in this client that is not a port — there is no adapter to
 * swap, and a second implementation would be a lie. What is injected instead is the two calls
 * this needs (`list`, `sizeOf`), so a test can describe a directory without creating one and a
 * path that does not exist is a refusal rather than a crash.
 *
 * What a confirmed path becomes is `attach-plan.ts`: this file answers *what can I pick*, which
 * runs on every keystroke, and that answers *what happens if I pick this*, which runs once.
 */

/**
 * Rows a picker shows. A directory with five thousand files must not become a five thousand line
 * render, and the count beside the list says how many are not shown.
 */
export const MAX_SUGGESTIONS = 8;

export interface AttachCandidate {
	readonly name: string;
	/** The full path, exactly as it will be handed to the engine. */
	readonly path: string;
	readonly isDirectory: boolean;
	/** Bytes; a directory, or a file that vanished, has none. */
	readonly size: number | null;
}

/** What a confirmed path becomes, or the sentence that says why it cannot. */
export type AttachPlan =
	| {
			readonly kind: "send";
			readonly file: { readonly path: string; readonly name: string; readonly size: number };
	  }
	| { readonly kind: "refused"; readonly reason: string };

/** The two filesystem calls, injectable so a test needs no files. */
export interface AttachFs {
	readonly list: (
		directory: string,
	) => readonly { readonly name: string; readonly isDirectory: boolean }[];
	readonly sizeOf: (path: string) => number | null;
}

export const nodeAttachFs: AttachFs = {
	list: (directory) => {
		const entries = readdirSync(directory, { withFileTypes: true });
		return entries.map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory() }));
	},
	sizeOf: (path) => {
		const stats = statSync(path);
		return stats.isFile() ? stats.size : null;
	},
};

export interface AttachContext {
	/** Where a relative path starts. The directory the client was started in. */
	readonly cwd: string;
	/** What `~` means. Injected because the sandbox's home is not the user's. */
	readonly home: string;
	readonly fs: AttachFs;
}

/**
 * The directory a draft names, and the fragment to filter it by.
 *
 * `~` is expanded because that is how a person types a path; everything else is resolved against
 * the directory the client was started in, so `docs/cv.pdf` means the same thing it would in the
 * shell the client was launched from. A trailing slash means "list this directory", which is what
 * makes `⇥` into a folder and typing a `/` the same gesture.
 */
export function draftSplit(
	draft: string,
	context: Pick<AttachContext, "cwd" | "home">,
): { readonly directory: string; readonly filter: string } {
	const expanded = draft.startsWith("~")
		? join(context.home, draft.slice(1).replace(/^\//, ""))
		: draft;
	if (expanded.length === 0 || expanded.endsWith("/")) {
		// The path to read, without the draft's trailing slash: `photos/` is how a person asks
		// for a listing, not a directory whose name ends in one.
		const named = expanded.replace(/\/+$/, "");
		const directory = named.length === 0 ? context.cwd : named;
		return {
			directory: isAbsolute(directory) ? directory : join(context.cwd, directory),
			filter: "",
		};
	}
	const directory = dirname(expanded);
	return {
		directory: isAbsolute(directory) ? directory : join(context.cwd, directory),
		filter: basename(expanded),
	};
}

/** What the prompt shows for a draft: the matching entries, and where the highlight sits. */
export interface AttachListing {
	readonly directory: string;
	readonly candidates: readonly AttachCandidate[];
	readonly picked: number;
	/** How many matches are not shown, because the list is capped. */
	readonly hidden: number;
}

/**
 * The entries a draft matches.
 *
 * Dotfiles are hidden unless the filter itself starts with a dot: `~` is full of them, and a
 * picker that opens on `.bashrc` when someone typed `ba` is worse than one that shows nothing.
 * A directory that cannot be read is an empty list, not an error — half a typed path is the
 * normal state of a prompt, not a failure.
 */
export function attachListing(draft: string, pick: number, context: AttachContext): AttachListing {
	const { directory, filter } = draftSplit(draft, context);
	const wanted = filter.toLowerCase();
	const showHidden = filter.startsWith(".");

	let entries: readonly { readonly name: string; readonly isDirectory: boolean }[] = [];
	try {
		entries = context.fs.list(directory);
	} catch {
		return { directory, candidates: [], picked: 0, hidden: 0 };
	}

	const matches = entries
		.filter((entry) => (showHidden ? true : !entry.name.startsWith(".")))
		.filter((entry) => entry.name.toLowerCase().startsWith(wanted))
		.sort((left, right) =>
			left.isDirectory === right.isDirectory
				? left.name.localeCompare(right.name)
				: left.isDirectory
					? -1
					: 1,
		);
	const shown = matches.slice(0, MAX_SUGGESTIONS);
	const candidates = shown.map((entry) => {
		const path = join(directory, entry.name);
		return {
			name: entry.name,
			path,
			isDirectory: entry.isDirectory,
			// Only the rows that are drawn are measured: a directory listing is not a place to
			// call stat() on ten thousand names.
			size: entry.isDirectory ? null : safeSize(context.fs, path),
		};
	});
	const picked = candidates.length === 0 ? 0 : Math.min(Math.max(0, pick), candidates.length - 1);
	return { directory, candidates, picked, hidden: Math.max(0, matches.length - candidates.length) };
}

function safeSize(fs: AttachFs, path: string): number | null {
	try {
		return fs.sizeOf(path);
	} catch {
		return null;
	}
}

/** The real filesystem, the real working directory and the real home. */
export function defaultAttachContext(): AttachContext {
	return { cwd: process.cwd(), home: homedir(), fs: nodeAttachFs };
}
