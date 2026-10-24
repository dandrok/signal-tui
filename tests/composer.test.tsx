import { describe, expect, test } from "bun:test";
import { render } from "ink-testing-library";
import { COMPOSER_HEIGHT, Composer } from "../src/ui/Composer";

const frameOf = (draft: string, isFocused: boolean, width = 40): string => {
	const { lastFrame, unmount } = render(
		<Composer draft={draft} isFocused={isFocused} width={width} />,
	);
	const frame = lastFrame() ?? "";
	unmount();
	return frame;
};

describe("Composer", () => {
	test("shows the typing prompt and cursor while focused", () => {
		const frame = frameOf("hey", true);
		expect(frame).toContain("hey");
		expect(frame).toContain("›");
		expect(frame).toContain("▌");
	});

	test("invites input when unfocused and empty", () => {
		expect(frameOf("", false)).toContain("i to write");
	});

	test("does not invite input when a draft is waiting", () => {
		const frame = frameOf("half a thought", false);
		expect(frame).toContain("half a thought");
		expect(frame).not.toContain("i to write");
	});

	test("keeps the end of a long draft visible instead of wrapping it away", () => {
		// One content row: rendering the whole draft would wrap and push the cursor
		// out of the box.
		const draft = `HEAD${"x".repeat(200)}END`;
		const frame = frameOf(draft, true);

		expect(frame).toContain("END");
		expect(frame).not.toContain("HEAD");
		expect(frame).toContain("…");
	});

	test("stays inside its frame height", () => {
		const frame = frameOf("y".repeat(500), true);
		const lines = frame.split("\n").filter((line) => line.length > 0);
		expect(lines.length).toBe(COMPOSER_HEIGHT);
	});
});
