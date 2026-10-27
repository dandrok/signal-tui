import { describe, expect, test } from "bun:test";
import type { Clock } from "../src/domain/format";
import { VIEW_ONCE_BODY } from "../src/domain/format";
import { messageRowCount, QUOTE_NOT_LOADED, quoteForDisplay } from "../src/domain/rows";
import type { Message } from "../src/domain/types";

/** A stub clock: layout assertions must not depend on ICU formatting. */
const clock: Clock = () => "10:00";

const message = (overrides: Partial<Message> = {}): Message => ({
	id: "c1:1000",
	conversationId: "c1",
	author: "Adam",
	body: "agreed",
	sentAt: 1_000,
	isOutgoing: false,
	isDeleted: false,
	...overrides,
});

const target = (overrides: Partial<Message> = {}): Message =>
	message({
		id: "c1:500",
		author: "Marta",
		body: "attachments path also needs the 4 MiB limit",
		sentAt: 500,
		...overrides,
	});

const reply = (overrides: Partial<Message> = {}): Message =>
	message({ quote: { sentAt: 500, authorId: "uuid-marta" }, ...overrides });

/** The lookup the pane builds: the thread's own rows, by sent time. */
const lookupFor =
	(...messages: readonly Message[]) =>
	(quote: { readonly sentAt: number }): Message | undefined =>
		messages.find((entry) => entry.sentAt === quote.sentAt);

const line = (replyMessage: Message, ...thread: readonly Message[]): string =>
	quoteForDisplay(replyMessage, 60, clock, lookupFor(...thread)).text;

describe("quoteForDisplay", () => {
	test("names the quoted author and repeats what they wrote", () => {
		expect(line(reply(), target())).toBe(
			"┃ 10:00 Marta: attachments path also needs the 4 MiB limit",
		);
	});

	test("our own message is quoted as You", () => {
		const ours = target({ isOutgoing: true, author: "You", authorId: "self" });

		expect(line(reply(), ours)).toBe("┃ 10:00 You: attachments path also needs the 4 MiB limit");
	});

	test("a deleted target says so instead of showing text that is gone", () => {
		const deleted = target({ body: "", isDeleted: true });

		expect(line(reply(), deleted)).toBe("┃ 10:00 Marta: message deleted");
	});

	test("an expired target says so", () => {
		const expired = target({ body: "", isExpired: true });

		expect(line(reply(), expired)).toBe("┃ 10:00 Marta: message expired");
	});

	test("a view-once target says so", () => {
		const viewOnce = target({ body: "", isViewOnce: true });

		expect(line(reply(), viewOnce)).toBe(`┃ 10:00 Marta: ${VIEW_ONCE_BODY}`);
	});

	test("a target that is not loaded falls back to the payload's identity", () => {
		// The window is bounded, so the quoted message may be in the cache and absent from
		// the pane — the label says what the pane can know, and the payload's identity is
		// what names the author it cannot resolve.
		expect(line(reply())).toBe(`┃ 10:00 uuid-marta: ${QUOTE_NOT_LOADED}`);
		expect(line(message({ quote: { sentAt: 500, authorId: null } }))).toBe(
			`┃ 10:00 unknown author: ${QUOTE_NOT_LOADED}`,
		);
	});

	test("a reply that is itself gone draws no quote", () => {
		// The row already says what happened to it. Naming what it answered would spend a
		// row of the window on context for words nobody can read, and a delete-for-everyone
		// would still be telling the reader which message it answered.
		const lookup = lookupFor(target(), reply());
		const gone = (overrides: Partial<Message>): number =>
			quoteForDisplay(reply({ body: "", ...overrides }), 60, clock, lookup).rows;

		expect(gone({ isDeleted: true })).toBe(0);
		expect(gone({ isExpired: true })).toBe(0);
		expect(gone({ isViewOnce: true })).toBe(0);
		// The control: the same reply, alive, does draw it.
		expect(gone({})).toBe(1);
	});

	test("costs one row whatever the quoted message's length", () => {
		const huge = target({ body: `START${"x".repeat(5_000)}ENDTAG` });

		const bounded = quoteForDisplay(reply(), 60, clock, lookupFor(huge));
		expect(bounded.rows).toBe(1);
		expect(bounded.truncated).toBe(true);
		expect(bounded.text).toContain("START");
		expect(bounded.text).not.toContain("ENDTAG");
	});

	test("counts as a row of overhead, so the pane can budget for it", () => {
		// Equality of the difference is the claim: a quote that costs no row would let the
		// body take one more and overflow the window.
		const plain = message();
		const quoted = reply();

		expect(messageRowCount(quoted, 60, clock, 10, lookupFor(target()))).toBe(
			messageRowCount(plain, 60, clock, 10) + 1,
		);
	});

	test("a quoted body is sanitised like any other text", () => {
		// The quoted message's body is remote text that the store keeps raw, so it goes
		// through the same display rules: an escape sequence must not reach the terminal.
		const hostile = target({ body: "\u001b[31mred\u001b[0m words" });

		const drawn = line(reply(), hostile);
		expect(drawn).toContain("red words");
		expect(drawn).not.toContain("\u001b");
	});

	test("a message that is not a reply draws nothing", () => {
		expect(quoteForDisplay(message(), 60, clock).rows).toBe(0);
	});
});
