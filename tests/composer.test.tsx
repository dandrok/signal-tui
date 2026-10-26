import { describe, expect, test } from "bun:test";
import { draftTail } from "../src/domain/layout";
import { COMPOSER_HEIGHT, Composer } from "../src/ui/Composer";
import { frameOf as renderFrame } from "./helpers/frame";

const frameOf = (draft: string, isFocused: boolean, width = 40): string =>
	renderFrame(<Composer draft={draft} isFocused={isFocused} width={width} />);

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

	test("does not wrap a pasted draft in full to show one row", () => {
		// 20 000 characters: the tail must still be one row, ending where the draft
		// ends. `draftTail` measures only the end, which is what keeps a keystroke
		// cheap on a pasted message.
		const draft = `HEAD${"x".repeat(20_000)}END`;
		const tail = draftTail(draft, 30);
		expect(tail.text.endsWith("END")).toBe(true);
		expect(tail.text.length).toBeLessThanOrEqual(30);
		expect(tail.truncated).toBe(true);

		const frame = frameOf(draft, true, 40);
		expect(frame).toContain("END");
		expect(frame).toContain("…");
		expect(frame).not.toContain("HEAD");
	});

	test("measures a bounded slice, not the whole pasted draft", () => {
		// Wrapping a 1 MiB draft takes ~360 ms on this machine (measured), the
		// bounded slice a few microseconds. The ceiling is deliberately loose: it
		// separates the two orders of magnitude without being flaky on CI.
		const draft = `HEAD${"x".repeat(1_000_000)}END`;
		const started = Bun.nanoseconds();
		const tail = draftTail(draft, 40);
		const elapsedMs = (Bun.nanoseconds() - started) / 1e6;

		expect(tail.text.endsWith("END")).toBe(true);
		expect(elapsedMs).toBeLessThan(100);
	});
});
