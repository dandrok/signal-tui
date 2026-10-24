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

	test("consumes CSI with colon sub-parameters whole", () => {
		// `38:2:255:0:0` is a valid true-colour SGR: only the leading `[0-9;?]` set
		// would stop at the colon and leave the parameters on screen as text.
		expect(displayText("red \u001b[38:2:255:0:0mRED")).toBe("red RED");
		expect(displayText("\u001b[4:3m")).toBe("");
	});

	test("consumes string-type escapes with their payload", () => {
		// DCS, SOS, PM and APC each carry a payload up to ST; leaving it would print
		// the payload as chat text.
		expect(displayText("a\u001bPpayload\u001b\\b")).toBe("ab");
		expect(displayText("a\u001b_payload\u001b\\b")).toBe("ab");
		expect(displayText("a\u001b^payload\u001b\\b")).toBe("ab");
		expect(displayText("a\u001bXpayload\u001b\\b")).toBe("ab");
	});

	test("consumes an OSC terminated by ST instead of BEL", () => {
		expect(displayText("a\u001b]0;title\u001b\\b")).toBe("ab");
	});

	test("consumes a CSI the peer never finished", () => {
		expect(displayText("a\u001b[38")).toBe("a");
	});

	test("recognises the 8-bit C1 forms of the same sequences", () => {
		// ECMA-48 allows a peer to send the C1 introducer instead of ESC + byte; a
		// sanitiser that only knows ESC leaves the parameters behind as text.
		expect(displayText("\u009b31mRED")).toBe("RED");
		expect(displayText("a\u0090payload\u009cb")).toBe("ab");
		expect(displayText("a\u009fpayload\u009cb")).toBe("ab");
	});

	test("a C1 string terminator closes the string it terminates", () => {
		// Otherwise the string branch runs on and swallows the text after it.
		expect(displayText("a\u009d0;title\u009cb")).toBe("ab");
	});

	test("strips C0 and C1 controls but keeps the text", () => {
		// \u0091 is a C1 control that introduces nothing, so only the byte goes; the
		// introducers themselves are covered by the 8-bit test above.
		expect(displayText("a\u0007b\u0008c\u0091d")).toBe("abcd");
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
