import { realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { nodeLaunch } from "./launch";
import { engineAttachmentsRoot } from "./root";

/**
 * Opening a received file: the shape of the decision, and the wiring that supplies it.
 *
 * This is the first thing the client does that leaves the terminal, so the rule is fixed
 * before the code: **the engine's own attachments directory is the only place a launch may
 * point at**. Everything else — a path typed into a caption, a filename a sender chose, a
 * path of ours that happens to be absolute — is someone else's text, and a terminal that runs
 * whatever a peer names is a remote code execution with extra steps. The directory itself is
 * `root.ts`; what a process does with a path is `launch.ts`.
 *
 * The filesystem is injected the same way the attach prompt injects it: the two calls this
 * needs (`realPath`, `isFile`), so a test describes a file without creating one, and a file
 * that vanished between the keystroke and the launch is a refusal rather than a crash.
 */

/** The two filesystem calls an open needs, injectable so a test needs no files. */
export interface OpenFs {
	/** The canonical path, or null when nothing is there. */
	readonly realPath: (path: string) => string | null;
	/** True only for a regular file: a directory has no viewer. */
	readonly isFile: (path: string) => boolean;
}

export const nodeOpenFs: OpenFs = {
	realPath: (path) => {
		try {
			return realpathSync(path);
		} catch {
			return null;
		}
	},
	isFile: (path) => {
		try {
			return statSync(path).isFile();
		} catch {
			return false;
		}
	},
};

export interface OpenContext {
	/**
	 * Where `signal-cli` writes what it downloads. Not a preference: it is the one directory
	 * a launch is allowed to reach into.
	 */
	readonly root: string;
	readonly fs: OpenFs;
	/**
	 * Hands a path to the desktop. Injectable so a test launches nothing.
	 *
	 * A promise rather than a fire-and-forget call: "it spawned" and "it could spawn" are
	 * different answers, and only the second one is worth telling the user about. The viewer
	 * itself is not waited for — nothing here cares when a window closes.
	 */
	readonly launch: (path: string) => Promise<void>;
}

/** The real attachments directory, the real filesystem and the real desktop opener. */
export function defaultOpenContext(engineArgs: readonly string[] = []): OpenContext {
	return {
		root: engineAttachmentsRoot(process.env, homedir(), engineArgs),
		fs: nodeOpenFs,
		launch: nodeLaunch,
	};
}
