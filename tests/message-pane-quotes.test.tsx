import { describe, expect, test } from "bun:test";
import type { Clock } from "../src/domain/format";
import type { Conversation, Message } from "../src/domain/types";
import { MessagePane } from "../src/ui/MessagePane";
import { frameOf, frameOf as renderFrame } from "./helpers/frame";

/** A stub clock: layout assertions must not depend on ICU formatting or the host zone. */
const clock: Clock = () => "10:00";

const conversation: Conversation = {
	id: "c1",
	name: "Signal devs",
	unreadCount: 0,
	lastActivityAt: 0,
};

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

const frameOfMessages = (messages: readonly Message[], height = 20): string =>
	frameOf(
		<MessagePane
			conversation={conversation}
			messages={messages}
			height={height}
			width={60}
			clock={clock}
		/>,
	);

const rows = (frame: string): number =>
	frame.split("\n").filter((line) => line.trim().length > 0).length;

describe("MessagePane quotes", () => {
	test("draws the quoted message above the reply", () => {
		const frame = frameOfMessages([target(), reply()]);

		// The pane is 60 columns, so the quoted line is cut at the edge rather than wrapped:
		// it is one row, and one row is all the window budgeted for it.
		expect(frame).toContain("┃ 10:00 Marta: attachments path also needs the 4 MiB");
		// The reply's own row is untouched: the quote is an extra line, not a rewrite.
		expect(frame).toContain("10:00 Adam");
		expect(frame).toContain("agreed");
	});

	test("a target that is gone reads as deleted instead of quoting its old text", () => {
		const frame = frameOfMessages([target({ isDeleted: true, body: "" }), reply()]);

		expect(frame).toContain("┃ 10:00 Marta: message deleted");
	});

	test("a quote is measured, so the window says what it hides", () => {
		// Four content rows: the reply (header, quote, body) plus the message it answers
		// (header, body) is five, so the target has to fall outside the window and the pane
		// has to say so. Measuring a quote as free fits both into four, and then ink —
		// anchored to the bottom — clips the oldest row instead of naming it.
		const frame = frameOfMessages([target({ body: "short" }), reply()], 7);

		expect(frame).toContain("↑ 1 older");
		expect(frame).toContain("┃ 10:00 Marta");
		expect(frame).toContain("10:00 Adam");
	});

	test("the quote is inside the reply's own row budget, so its header survives", () => {
		// Three content rows for a reply whose body wants more: header, quote, body. Handing
		// the body the rows the quote took draws four rows into three, and ink clips the
		// top of the message — its header — rather than the excess body.
		const frame = frameOfMessages([target(), reply({ body: "z".repeat(400) })], 6);

		expect(frame).toContain("10:00 Adam");
		expect(frame).toContain("┃ 10:00 Marta");
		expect(rows(frame)).toBeLessThanOrEqual(6);
	});

	test("a reply whose target is outside the window still says what it answers", () => {
		// Only the identity is cached, so a thread that does not hold the quoted message is
		// the case where the pane cannot show its text — and it says so rather than quoting
		// an empty line.
		const frame = frameOfMessages([reply()]);

		expect(frame).toContain("┃ 10:00 uuid-marta: not loaded");
	});

	test("marks the message the keyboard is pointing at", () => {
		// The selection exists either way; without a marker `j`/`k` move something invisible
		// and `r` looks like it only ever answers the newest message.
		const frame = renderFrame(
			<MessagePane
				conversation={conversation}
				messages={[target(), reply()]}
				height={20}
				width={60}
				clock={clock}
				cursorId="c1:1000"
			/>,
		);

		expect(frame).toContain("▸ 10:00 Adam");
		// One marker, on one row: the other message is not selected.
		expect(frame.split("▸").length - 1).toBe(1);
	});

	test("a reply that was deleted for everyone draws no quote", () => {
		// Its row already reports the deletion; naming what it answered would keep showing
		// the reply's context after the sender asked for the message to go.
		const frame = frameOfMessages([target(), reply({ isDeleted: true, body: "" })]);

		expect(frame).toContain("message deleted");
		expect(frame).not.toContain("┃ 10:00 Marta");
	});
});
