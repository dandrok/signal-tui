import { describe, expect, test } from "bun:test";
import { Composer } from "../src/ui/Composer";
import { frameOf } from "./helpers/frame";

/**
 * The composer's one content row is the only place a terminal has for "someone is writing"
 * without spending a row of the thread — so it fills the row that would otherwise invite the
 * user to write, and gives it back the moment they do.
 */

describe("Composer typing line", () => {
	test("an empty composer says who is writing", () => {
		const frame = frameOf(<Composer draft="" isFocused={false} width={40} typing="Mum" />);

		expect(frame).toContain("Mum is typing…");
		// The invitation to type is the less useful fact while someone else is mid-sentence.
		expect(frame).not.toContain("i to write");
	});

	test("a draft of your own keeps the row, because you are the one writing", () => {
		const frame = frameOf(<Composer draft="hi" isFocused={true} width={40} typing="Mum" />);

		expect(frame).not.toContain("is typing");
		expect(frame).toContain("hi");
	});

	test("no notice, no line", () => {
		const frame = frameOf(<Composer draft="" isFocused={false} width={40} />);

		expect(frame).not.toContain("is typing");
		expect(frame).toContain("i to write");
	});

	test("a name long enough to overflow is cut, not wrapped", () => {
		// A wrapped row would push the composer out of its own frame.
		const frame = frameOf(
			<Composer draft="" isFocused={false} width={24} typing={"Somebody With A Very Long Name"} />,
		);

		expect(frame).toContain("is typing");
		expect(frame).not.toContain("Somebody With A Very Long Name");
	});
});
