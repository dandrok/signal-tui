import { describe, expect, test } from "bun:test";
import { type AppRun, runWithScreen } from "../src/cli/run-app";

/**
 * The lifecycle that has no second chance.
 *
 * Everything here asserts an order, because the failure it prevents is a terminal left in the
 * second buffer: the screen has to be given back whatever happens in the middle, and the engine has
 * to be stopped even when mounting threw.
 */

const recorder = (
	options: { readonly mountThrows?: boolean; readonly exitRejects?: boolean } = {},
) => {
	const events: string[] = [];
	const app: AppRun<{ waitUntilExit: () => Promise<unknown> }> = {
		takeOver: () => {
			events.push("take-over");
			return () => events.push("release-screen");
		},
		mount: () => {
			if (options.mountThrows === true) {
				events.push("mount-threw");
				throw new Error("bad prop");
			}
			events.push("mount");
			return {
				waitUntilExit: async () => {
					events.push("wait");
					if (options.exitRejects === true) {
						throw new Error("exit failed");
					}
				},
			};
		},
		dispose: async () => {
			events.push("dispose");
		},
	};
	return { events, app };
};

describe("running the app", () => {
	test("takes the screen, waits, then gives the screen back before shutting down", async () => {
		const { events, app } = recorder();

		await runWithScreen(app);

		// Screen first: a shutdown that reports a failure after the buffer was restored is readable.
		expect(events).toEqual(["take-over", "mount", "wait", "release-screen", "dispose"]);
	});

	test("gives the screen back and stops the engine when mounting throws", async () => {
		// The bug this exists for: `render()` throwing is enough to skip a `finally` that begins one
		// line later, and the user is left with a terminal showing nothing and an orphaned engine.
		const { events, app } = recorder({ mountThrows: true });

		await expect(runWithScreen(app)).rejects.toThrow("bad prop");

		expect(events).toEqual(["take-over", "mount-threw", "release-screen", "dispose"]);
	});

	test("gives the screen back when waiting fails", async () => {
		const { events, app } = recorder({ exitRejects: true });

		await expect(runWithScreen(app)).rejects.toThrow("exit failed");

		expect(events).toEqual(["take-over", "mount", "wait", "release-screen", "dispose"]);
	});

	test("gives the screen back even when shutting down throws", async () => {
		const { events, app } = recorder();

		await expect(
			runWithScreen({
				...app,
				dispose: async () => {
					events.push("dispose-threw");
					throw new Error("cache busy");
				},
			}),
		).rejects.toThrow("cache busy");

		// The screen is what a user cannot fix; the failure is what they can.
		expect(events).toEqual(["take-over", "mount", "wait", "release-screen", "dispose-threw"]);
	});
});
