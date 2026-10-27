import { describe, expect, test } from "bun:test";
import { emojiInputSummary } from "../src/app/usecases/react";

/**
 * A refusal has to name what it refused.
 *
 * "not one emoji: nothing sent" was the same sentence for an empty prompt, two emoji and a
 * pasted paragraph — which is how a stale-draft bug read as an emoji-parsing bug for a while.
 * The interesting failures are the invisible ones, so the summary spells code points.
 */
describe("emojiInputSummary", () => {
	test("an empty draft says so in words", () => {
		expect(emojiInputSummary("")).toBe("nothing typed");
	});

	test("one emoji names its code point", () => {
		expect(emojiInputSummary("👍")).toBe("1 character (U+1F44D)");
	});

	test("two emoji are counted, not just judged", () => {
		expect(emojiInputSummary("👍👍")).toBe("2 characters (U+1F44D U+1F44D)");
	});

	test("an invisible character is visible here", () => {
		// U+200B renders as nothing, which is exactly why it needs naming.
		expect(emojiInputSummary("\u200b")).toBe("1 character (U+200B)");
	});

	test("a long paste is truncated rather than dumped into the status line", () => {
		expect(emojiInputSummary("abcdefghij")).toBe(
			"10 characters (U+0061 U+0062 U+0063 U+0064 U+0065 U+0066 …)",
		);
	});
});
