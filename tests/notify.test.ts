import { describe, expect, test } from "bun:test";
import type { Message } from "../src/domain/types";
import {
	bell,
	incomingSequence,
	notificationLine,
	notificationText,
	title,
	toast,
	unreadTitle,
} from "../src/ui/notify";

const BEL = "\u0007";

const message = (overrides: Partial<Message> = {}): Message => ({
	id: "c1:1000",
	conversationId: "c1",
	author: "Marta",
	authorId: "uuid-marta",
	body: "the build is green",
	sentAt: 1_000,
	isOutgoing: false,
	isDeleted: false,
	...overrides,
});

describe("notificationText", () => {
	test("keeps remote text on one line and out of the sequence's syntax", () => {
		// The body is a peer's words: a newline would break the toast, and a `;` would be
		// read as another field of the sequence.
		expect(notificationText("hello\nworld; rm -rf /")).toBe("hello world, rm -rf /");
	});

	test("drops the control characters a peer could send", () => {
		const hostile = notificationText("a\u001b[31mb\u0007c");

		expect(hostile).not.toContain("\u001b");
		expect(hostile).not.toContain(BEL);
	});

	test("caps a paste instead of filling the screen", () => {
		const capped = notificationText("x".repeat(500));

		expect(capped.length).toBeLessThanOrEqual(120);
		expect(capped.endsWith("…")).toBe(true);
	});
});

describe("notificationLine", () => {
	test("names the sender and repeats what they wrote", () => {
		expect(notificationLine({ message: message(), conversationName: "Marta" })).toBe(
			"Marta: the build is green",
		);
	});

	test("names the group too when it is not the sender", () => {
		expect(notificationLine({ message: message(), conversationName: "Signal devs" })).toBe(
			"Signal devs · Marta: the build is green",
		);
	});

	test("falls back to the sender when the cache has no thread name yet", () => {
		expect(notificationLine({ message: message(), conversationName: "" })).toBe(
			"Marta: the build is green",
		);
	});

	test("says what a view-once or deleted row is instead of nothing", () => {
		// The cache keeps no text for these; a toast with an empty body would look broken.
		expect(
			notificationLine({
				message: message({ isViewOnce: true, body: "" }),
				conversationName: "Marta",
			}),
		).toContain("view-once");
		expect(
			notificationLine({
				message: message({ isDeleted: true, body: "" }),
				conversationName: "Marta",
			}),
		).toContain("deleted");
	});
});

describe("notification sequences", () => {
	test("the bell is the byte every terminal understands", () => {
		expect(bell()).toBe(BEL);
	});

	test("a toast is one OSC 9 sequence, terminated by BEL", () => {
		expect(toast("hi")).toBe("\u001b]9;hi\u0007");
	});

	test("the title is OSC 2, so a shell prompt does not have to be re-set", () => {
		expect(title("signal-tui")).toBe("\u001b]2;signal-tui\u0007");
	});

	test("the title counts unread messages, and drops the count at zero", () => {
		expect(unreadTitle(0)).toBe("signal-tui");
		expect(unreadTitle(3)).toBe("signal-tui · 3 unread");
	});

	test("an arriving message rings first, then shows the toast", () => {
		const sequence = incomingSequence({ message: message(), conversationName: "Marta" });

		expect(sequence).toBe(`${BEL}\u001b]9;Marta: the build is green${BEL}`);
	});
});
