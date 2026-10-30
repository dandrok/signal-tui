import { describe, expect, test } from "bun:test";
import { messageRowCount, separatorFor, separatorRows } from "../src/domain/rows";
import type { Conversation, Message } from "../src/domain/types";
import { MessagePane } from "../src/ui/message-pane";
import { stubClock } from "./helpers/clock";
import { frameOf } from "./helpers/frame";

/**
 * Where one day ends and the next begins.
 *
 * The thread prints `14:03` and nothing else, so without a divider a conversation that ran past
 * midnight reads as one unbroken afternoon, and scrolling back a week shows no seam at all.
 */

const clock = stubClock();
const DAY = 86_400_000;
const MINUTE = 60_000;

const conversation: Conversation = { id: "c1", name: "Marta", unreadCount: 0, lastActivityAt: 0 };

const message = (index: number, overrides: Partial<Message> = {}): Message => ({
	id: `m-${index}`,
	conversationId: "c1",
	author: "Marta",
	authorId: "uuid-marta",
	body: `body-${index}`,
	sentAt: index * MINUTE,
	isOutgoing: false,
	isDeleted: false,
	...overrides,
});

const pane = (messages: readonly Message[]): string =>
	frameOf(
		<MessagePane
			conversation={conversation}
			messages={messages}
			height={20}
			width={60}
			clock={clock}
		/>,
	);

describe("a date divider", () => {
	test("is drawn where the day changes, and only there", () => {
		const frame = pane([
			message(0),
			message(1, { body: "still today" }),
			message(2, { sentAt: DAY + 3 * MINUTE, body: "next morning" }),
		]);

		expect(occurrences(frame, "Fri 30 Oct")).toBe(1);
		expect(frame).toContain("next morning");
	});

	test("is not drawn inside one day", () => {
		const frame = pane([message(0), message(1), message(2, { sentAt: 23 * 60 * MINUTE })]);

		expect(occurrences(frame, "Fri 30 Oct")).toBe(0);
	});

	test("spans the text area, so it reads as a rule rather than a word", () => {
		const frame = pane([message(0), message(1, { sentAt: DAY + MINUTE })]);
		const divider = frame.split("\n").find((line) => line.includes("Fri 30 Oct"));

		expect(divider).toBeDefined();
		expect(divider).toContain("─".repeat(6));
	});

	test("costs exactly one row, which is what the window budgets for", () => {
		// Same message, same previous, same width: the only difference is which side of midnight
		// the second one falls on.
		// Ten minutes after the message above it either way, so both rows carry a header: the one
		// difference left is the day.
		const sameDay = messageRowCount(
			message(1, { sentAt: 10 * MINUTE }),
			40,
			clock,
			20,
			undefined,
			"",
			message(0),
		);
		const nextDay = messageRowCount(
			message(1, { sentAt: DAY + 10 * MINUTE }),
			40,
			clock,
			20,
			undefined,
			"",
			message(0),
		);

		expect(nextDay).toBe(sameDay + 1);
	});

	test("is not drawn for the first message in the pane", () => {
		// There is nothing above it to divide from; a rule at the top of a thread reads as content.
		expect(separatorFor(undefined, message(0), clock)).toEqual({ kind: "none" });
		expect(separatorRows(separatorFor(undefined, message(0), clock))).toBe(0);
	});

	test("is decided by the clock's day, not by the distance between stamps", () => {
		// Two minutes apart across a zone's midnight is a new day; twelve hours apart inside one is
		// not. Both cases turn on `dayKey`, which is why the clock carries it.
		const lateNight = message(0, { sentAt: DAY - 2 * MINUTE });
		const justAfter = message(1, { sentAt: DAY + MINUTE });
		expect(separatorFor(lateNight, justAfter, clock).kind).toBe("day");

		const morning = message(2, { sentAt: 8 * 60 * MINUTE });
		const evening = message(3, { sentAt: 20 * 60 * MINUTE });
		expect(separatorFor(morning, evening, clock).kind).toBe("none");
	});
});

/** How many times a string is drawn. */
const occurrences = (frame: string, needle: string): number => frame.split(needle).length - 1;
