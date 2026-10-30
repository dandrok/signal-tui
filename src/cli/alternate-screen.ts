/**
 * The terminal's second screen buffer — the thing that makes this an app instead of a command.
 *
 * lazygit and lazydocker take the screen over and give it back untouched on exit. A client that
 * instead draws into the normal buffer leaves its last frame on screen above the prompt and lets
 * the wheel scroll the shell history out from under a UI that is still running, which is not a
 * preference: the two are simply sharing one buffer.
 *
 * `?1049` is the pair of escapes for that switch. Entering saves the cursor and clears the screen,
 * leaving restores both — including everything that was on screen before the client started.
 */

/** Enter the alternate screen. */
export const ENTER_ALTERNATE_SCREEN = "\u001b[?1049h";

/** Leave it again, restoring the normal buffer. */
export const LEAVE_ALTERNATE_SCREEN = "\u001b[?1049l";

/** The only part of a stream this module needs, so a test can be one object. */
export interface ScreenSink {
	readonly write: (chunk: string) => unknown;
	readonly isTTY?: boolean | undefined;
}

/**
 * Take the screen over and hand back the one function that gives it back.
 *
 * The returned restore is idempotent and safe to call from a signal handler: a client that leaves
 * the user's terminal showing nothing because it was killed is worse than one that never took the
 * screen. A pipe has no screen to take over (`signal-tui --demo | cat`, CI), so nothing is written
 * there and the caller gets a no-op.
 */
export function takeOverScreen(sink: ScreenSink): () => void {
	if (sink.isTTY !== true) {
		return () => undefined;
	}
	sink.write(ENTER_ALTERNATE_SCREEN);
	let released = false;
	return () => {
		if (released) {
			return;
		}
		released = true;
		sink.write(LEAVE_ALTERNATE_SCREEN);
	};
}
