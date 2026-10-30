import { describe, expect, test } from "bun:test";
import {
	ENTER_ALTERNATE_SCREEN,
	LEAVE_ALTERNATE_SCREEN,
	takeOverScreen,
} from "../src/cli/alternate-screen";

/** A stream that only records: the module writes two sequences and reads one flag. */
const sink = (isTTY: boolean | undefined) => {
	const written: string[] = [];
	return {
		written,
		write: (chunk: string): void => {
			written.push(chunk);
		},
		isTTY,
	};
};

describe("the second screen buffer", () => {
	test("is entered at once and left when the app is done", () => {
		const stream = sink(true);
		const restore = takeOverScreen(stream);

		expect(stream.written).toEqual([ENTER_ALTERNATE_SCREEN]);

		restore();

		expect(stream.written).toEqual([ENTER_ALTERNATE_SCREEN, LEAVE_ALTERNATE_SCREEN]);
	});

	test("is left exactly once, so a signal and a normal exit cannot fight", () => {
		const stream = sink(true);
		const restore = takeOverScreen(stream);

		restore();
		restore();
		restore();

		expect(stream.written.filter((chunk) => chunk === LEAVE_ALTERNATE_SCREEN)).toHaveLength(1);
	});

	test("is never entered on a stream that has no screen", () => {
		// A pipe: `--demo | cat`, a test runner, CI. Writing `?1049h` there puts garbage in the
		// captured output and nothing on any screen.
		for (const isTTY of [false, undefined]) {
			const stream = sink(isTTY);
			const restore = takeOverScreen(stream);
			restore();

			expect(stream.written).toEqual([]);
		}
	});

	test("the sequences are the ones that switch buffers, not the ones that only clear", () => {
		// `?1049` saves the cursor and restores it with its screen; `?1047`/`?47` clear without
		// restoring, which is how a client leaves a terminal with its scrollback intact but its
		// cursor somewhere unexpected.
		expect(ENTER_ALTERNATE_SCREEN).toBe("\u001b[?1049h");
		expect(LEAVE_ALTERNATE_SCREEN).toBe("\u001b[?1049l");
	});
});
