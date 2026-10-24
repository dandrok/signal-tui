import { describe, expect, test } from "bun:test";
import { displayLine, displayText } from "../src/domain/display";

describe("displayText", () => {
	test("strips SGR, which ink would otherwise pass to the terminal", () => {
		expect(displayText("\u001b[31mRED\u001b[0m")).toBe("RED");
		expect(displayText("\u001b[8mhidden\u001b[0m")).toBe("hidden");
	});

	test("strips OSC sequences, including a clipboard write", () => {
		expect(displayText("a\u001b]52;c;cHduZWQ=\u0007b")).toBe("ab");
		expect(displayText("a\u001b]0;title\u0007b")).toBe("ab");
	});

	test("strips bidi overrides that reverse what the text says", () => {
		// Without this "invoice‮txt.exe" renders as "invoicetxt.exe" — the name a
		// reviewer would read as harmless.
		expect(displayText("invoice\u202etxt.exe")).toBe("invoicetxt.exe");
		expect(displayText("\u2066a\u2069")).toBe("a");
	});

	test("strips zero-width characters that make two strings look identical", () => {
		expect(displayText("pay\u200Bpal.com")).toBe("paypal.com");
		expect(displayText("\uFEFFok")).toBe("ok");
	});

	test("strips C0 and C1 controls but keeps the text", () => {
		expect(displayText("a\u0007b\u0008c\u009bd")).toBe("abcd");
	});

	test("turns tabs into spaces and normalises line breaks", () => {
		expect(displayText("a\tb")).toBe("a b");
		expect(displayText("a\r\nb\rc")).toBe("a\nb\nc");
	});

	test("keeps legitimate multi-line bodies", () => {
		expect(displayText("first\nsecond")).toBe("first\nsecond");
	});

	test("leaves ordinary text alone, accents and emoji included", () => {
		const text = "Zażółć gęślą jaźń 📎 ok";
		expect(displayText(text)).toBe(text);
	});
});

describe("displayLine", () => {
	test("collapses breaks so a one-row label cannot grow rows", () => {
		expect(displayLine("Marta\nMarta")).toBe("Marta Marta");
		expect(displayLine("a\tb")).toBe("a b");
	});

	test("trims the ends", () => {
		expect(displayLine("  Marta  ")).toBe("Marta");
	});

	test("removes the same directives as the multi-line variant", () => {
		expect(displayLine("\u001b[31mMarta\u202e")).toBe("Marta");
	});

	test("keeps a name that is only spaces from becoming empty by accident", () => {
		expect(displayLine("\u200b")).toBe("");
	});
});
