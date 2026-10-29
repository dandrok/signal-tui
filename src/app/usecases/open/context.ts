import { spawn } from "node:child_process";
import { realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";

/**
 * Opening a received file: the paths a launch may reach, and the two calls it needs.
 *
 * This is the first thing the client does that leaves the terminal, so the rule is fixed
 * before the code: **the engine's own attachments directory is the only place a launch may
 * point at**. Everything else — a path typed into a caption, a filename a sender chose, a
 * path of ours that happens to be absolute — is someone else's text, and a terminal that runs
 * whatever a peer names is a remote code execution with extra steps.
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

/**
 * Where signal-cli keeps what it downloaded: its own data directory, under `attachments`.
 *
 * Read the way the engine reads it rather than guessed from the account, because the engine
 * is what wrote the file. `XDG_DATA_HOME` counts only when it is absolute — the spec says a
 * relative one is ignored, and the engine ignores it, so honouring it here would point the
 * guard at a directory the engine never used.
 */
export function engineAttachmentsRoot(
	env: Readonly<Record<string, string | undefined>> = process.env,
	home: string = homedir(),
): string {
	const data = env.XDG_DATA_HOME;
	const base = data !== undefined && isAbsolute(data) ? data : join(home, ".local", "share");
	return join(base, "signal-cli", "attachments");
}

/**
 * Whether `path` is inside `root`, by the components of the path and not by its text.
 *
 * Both sides are resolved first, so `…/attachments/../.bashrc` is refused rather than read as
 * a clever path that starts with the root. The root itself is not a file, so equality does not
 * count: a launch has to name something *below* it.
 */
export function inAttachmentsDir(path: string, root: string): boolean {
	if (!isAbsolute(path) || !isAbsolute(root)) {
		return false;
	}
	const target = resolve(path);
	const base = resolve(root);
	return target.startsWith(base.endsWith(sep) ? base : `${base}${sep}`);
}

/** The desktop's handler for a path, per platform; there is no terminal fallback. */
const systemOpener = (): string => (process.platform === "darwin" ? "open" : "xdg-open");

/**
 * Starts the desktop's viewer, and resolves once it has started.
 *
 * Detached and with its output discarded, because the child outlives the redraw: a viewer
 * that held the pipe open would make the TUI wait on a window it does not own.
 *
 * The promise is the point. A missing opener, a permission problem or a binary that vanished
 * between the look-up and the call all arrive as a rejection on the next tick — after the key
 * was pressed but before anyone was told it worked. Resolving on `spawn` rather than returning
 * at once is what keeps "opened photo.jpg" from being printed by a client that started nothing.
 */
export function nodeLaunch(path: string): Promise<void> {
	const opener = systemOpener();
	if (Bun.which(opener) === null) {
		return Promise.reject(new Error(`${opener} is not on PATH`));
	}
	return new Promise((resolve, reject) => {
		const child = spawn(opener, [path], { detached: true, stdio: "ignore" });
		child.once("spawn", () => {
			// The viewer outlives us: no exit to wait for, no pipe to keep open.
			child.unref();
			resolve();
		});
		child.once("error", reject);
	});
}

/** The real attachments directory, the real filesystem and the real desktop opener. */
export function defaultOpenContext(): OpenContext {
	return { root: engineAttachmentsRoot(), fs: nodeOpenFs, launch: nodeLaunch };
}
