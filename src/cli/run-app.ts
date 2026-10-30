/**
 * The app's lifecycle, in the order it has to happen: take the screen, mount, wait, and give
 * everything back — including when mounting or waiting is what failed.
 *
 * It lives here rather than inline in the entrypoint because the entrypoint is a script nobody can
 * call twice: a `finally` that starts one line too late leaves the user's terminal in the second
 * buffer with the engine still running behind it, and that is not a bug a frame test can see.
 */

/** The part of an ink instance this needs: a way to wait, and a way to stop waiting. */
export interface MountedApp {
	// `unknown`, because that is what ink resolves with — a narrower type rejects the real instance.
	readonly waitUntilExit: () => Promise<unknown>;
}

export interface AppRun<T extends MountedApp> {
	/** Takes the screen over and returns the one function that gives it back. */
	readonly takeOver: () => () => void;
	readonly mount: () => T;
	/** Stops the engine and closes the cache. Runs once, whatever happened above. */
	readonly dispose: () => Promise<void>;
}

/**
 * Runs the app to completion and releases the screen and the engine on the way out.
 *
 * `dispose` runs after the screen is released, and deliberately: shutting down is where a failure
 * gets *reported*, and a report printed into a buffer nobody will look at again is a lost error.
 */
export async function runWithScreen<T extends MountedApp>(app: AppRun<T>): Promise<void> {
	const releaseScreen = app.takeOver();
	try {
		await app.mount().waitUntilExit();
	} finally {
		releaseScreen();
		await app.dispose();
	}
}
