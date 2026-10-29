import { spawn } from "node:child_process";

/**
 * Handing a path to the desktop, and telling the truth about whether it worked.
 *
 * Split from `context.ts` when the composition passed the file cap, along the line the two
 * halves already had: this file is about a process, that one is about which paths may become
 * one.
 */

/** The desktop's handler for a path, per platform; there is no terminal fallback. */
const systemOpener = (): string => (process.platform === "darwin" ? "open" : "xdg-open");

/**
 * How long a launcher may take before "it started" counts as success.
 *
 * `xdg-open` exits non-zero when nothing can handle the file — that is the common failure, and
 * it happens in milliseconds. It is allowed to stay in the foreground while the viewer it
 * started does, though, so waiting for it to exit would make a working open look stuck. So the
 * answer is "it did not fail immediately": an exit inside this window is the verdict, and
 * silence past it is a success.
 */
const STARTUP_WINDOW_MS = 500;

/**
 * Starts the desktop's viewer, and resolves once it has not failed.
 *
 * Detached and with its output discarded, because a child that outlives the redraw must not
 * hold the TUI's pipe open. The promise is the point: a missing opener, an argument problem or
 * a file type nothing handles all arrive as a rejection — after the key was pressed, before
 * anyone was told it worked, which is the difference between a notice and a lie.
 *
 * Resolving on `spawn` alone is not enough. `xdg-open` forks happily and then exits `3` because
 * the desktop has no handler for a `.flac`: the process started, and nothing opened. Code 0 or
 * still running at the deadline is an open; a non-zero exit is the failure.
 */
export function nodeLaunch(path: string): Promise<void> {
	const opener = systemOpener();
	if (Bun.which(opener) === null) {
		return Promise.reject(new Error(`${opener} is not on PATH`));
	}
	return new Promise((resolve, reject) => {
		const child = spawn(opener, [path], { detached: true, stdio: "ignore" });
		let settled = false;
		const settle = (finish: () => void): void => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timer);
			finish();
		};
		// The timer must not keep the process alive on its own: it is a deadline, not work.
		const timer = setTimeout(() => {
			settle(() => {
				// No exit yet: the viewer is attached, or the opener is waiting on it.
				child.unref();
				resolve();
			});
		}, STARTUP_WINDOW_MS);
		timer.unref?.();
		child.once("error", (error) => settle(() => reject(error)));
		child.once("exit", (code, signal) =>
			settle(() => {
				if (code === 0) {
					resolve();
					return;
				}
				reject(
					new Error(
						code === null
							? `${opener} was killed by ${signal ?? "a signal"}`
							: `${opener} exited with ${code}`,
					),
				);
			}),
		);
	});
}
