import { describe, expect, test } from "bun:test";
import type { Clock } from "../src/domain/format";
import { attachmentsForDisplay, bodyForDisplay, messageRowCount } from "../src/domain/format";
import type { Conversation, Message } from "../src/domain/types";
import { ConversationList, listWindowStart } from "../src/ui/ConversationList";
import { visibleWindow } from "../src/ui/MessagePane";
import { frameOf } from "./helpers/frame";

/** A fixed clock keeps row arithmetic independent of the host timezone. */
const clock: Clock = () => "10:00";

const conversation = (index: number): Conversation => ({
	id: `c-${index}`,
	name: `Person ${index}`,
	unreadCount: 0,
	lastActivityAt: 0,
});

const message = (index: number, overrides: Partial<Message> = {}): Message => ({
	id: `m-${index}`,
	conversationId: "c-0",
	author: "Marta",
	body: `body-${index}`,
	sentAt: index,
	isOutgoing: false,
	isDeleted: false,
	...overrides,
});

const many = (count: number, overrides: Partial<Message> = {}): readonly Message[] =>
	Array.from({ length: count }, (_unused, index) => message(index, overrides));

describe("listWindowStart", () => {
	test("does not scroll while everything fits", () => {
		expect(listWindowStart(3, 5, 2)).toBe(0);
	});

	test("keeps the selection at the bottom edge of the window", () => {
		expect(listWindowStart(12, 3, 11)).toBe(9);
	});

	test("keeps the window still while the cursor moves inside it", () => {
		expect(listWindowStart(12, 3, 10)).toBe(9);
		expect(listWindowStart(12, 3, 9)).toBe(9);
	});

	test("never scrolls past the last page", () => {
		expect(listWindowStart(12, 3, 99)).toBe(9);
	});
});

describe("ConversationList", () => {
	const conversations = Array.from({ length: 12 }, (_unused, index) => conversation(index));

	test("renders the selection even when it is far below the fold", () => {
		const frame = frameOf(
			<ConversationList
				conversations={conversations}
				selectedIndex={11}
				width={30}
				height={6}
				isFocused
			/>,
		);

		expect(frame).toContain("Person 11");
		expect(frame).not.toContain("Person 0");
	});

	test("counts what is hidden above and below", () => {
		const frame = frameOf(
			<ConversationList conversations={conversations} selectedIndex={2} width={30} height={6} />,
		);

		expect(frame).toContain("↑2");
		expect(frame).toContain("↓7");
	});

	test("stays on the last page when the cursor reaches the bottom", () => {
		const frame = frameOf(
			<ConversationList conversations={conversations} selectedIndex={11} width={30} height={6} />,
		);

		expect(frame).toContain("↑9");
		expect(frame).not.toContain("↓");
	});
});

describe("messageRowCount", () => {
	test("charges a row per file on top of the author line", () => {
		const withFile = message(0, {
			body: "",
			attachments: [
				{
					id: "a1",
					contentType: "image/png",
					filename: "/tmp/a.png",
					size: 10,
					caption: null,
					isVoiceNote: false,
				},
			],
		});
		expect(messageRowCount(withFile, 40, clock)).toBe(2);
	});

	test("wraps a long body across the pane width", () => {
		expect(messageRowCount(message(0, { body: "x".repeat(85) }), 40, clock)).toBe(4);
	});

	test("counts explicit newlines as their own rows", () => {
		// Two lines inside one string: ink renders two rows, so the window must
		// charge two — measuring string length would charge one.
		expect(messageRowCount(message(0, { body: "first\nsecond" }), 40, clock)).toBe(3);
	});

	test("counts a wide character as the two cells it occupies", () => {
		// 40 CJK characters are 80 cells: two rows in a 40-column pane.
		expect(messageRowCount(message(0, { body: "字".repeat(40) }), 40, clock)).toBe(3);
	});

	test("stops measuring a body past the tallest possible window", () => {
		// A message can never count taller than the pane it is drawn in, and only
		// the rows' worth of text is wrapped: an 8 MiB body must not be measured in
		// full for a 5-row window.
		expect(messageRowCount(message(0, { body: "x".repeat(100_000) }), 20, clock, 5)).toBe(5);
	});

	test("charges the extra row a long author name wraps onto", () => {
		// Header is "10:04 " + author; a 30-character name needs two rows at width 20.
		expect(messageRowCount(message(0, { author: "a".repeat(30), body: "" }), 20, clock)).toBe(2);
	});

	test("charges the extra row a long filename wraps onto", () => {
		const longName = {
			id: "a1",
			contentType: "image/png",
			filename: `/${"n".repeat(60)}.png`,
			size: 1024,
			caption: null,
			isVoiceNote: false,
		};
		// "📎 " + a 64-character name + " (1.0 KB)" is 76 cells: four file rows at
		// width 20, plus the header, where charging one row would have said two.
		expect(messageRowCount(message(0, { body: "", attachments: [longName] }), 20, clock)).toBe(5);
	});

	test("ignores files on a deleted message", () => {
		const deleted = message(0, {
			isDeleted: true,
			body: "",
			attachments: [
				{
					id: "a1",
					contentType: "image/png",
					filename: "/tmp/a.png",
					size: 10,
					caption: null,
					isVoiceNote: false,
				},
			],
		});
		expect(messageRowCount(deleted, 40, clock)).toBe(2);
	});
});

describe("visibleWindow", () => {
	test("fills from the newest message, never past the row budget", () => {
		// Five rows of room, two rows per message: the newest two fit.
		expect(visibleWindow(many(8), 5, 0, 40, clock)).toEqual({ start: 6, end: 8, hiddenAbove: 6 });
	});

	test("scrolling moves the window back through history", () => {
		expect(visibleWindow(many(8), 5, 2, 40, clock)).toEqual({ start: 4, end: 6, hiddenAbove: 4 });
	});

	test("a scroll past the start clamps to the oldest message", () => {
		// Not an empty window: the reducer only clamps at zero, so a held `k` or a
		// page-up must not turn the conversation into "no messages yet".
		expect(visibleWindow(many(8), 5, 99, 40, clock)).toEqual({ start: 0, end: 1, hiddenAbove: 0 });
	});

	test("always renders one message, even when it is taller than the pane", () => {
		const tall = [message(0, { body: "x".repeat(400) })];
		expect(visibleWindow(tall, 3, 0, 20, clock)).toEqual({ start: 0, end: 1, hiddenAbove: 0 });
	});
});

describe("bodyForDisplay", () => {
	test("leaves a body that fits alone", () => {
		expect(bodyForDisplay(message(0, { body: "short" }), 10, 40)).toEqual({
			text: "short",
			truncated: false,
			rows: 1,
		});
	});

	test("cuts a body to the rows the pane can draw and says so", () => {
		const body = `${"x".repeat(500)}TAIL`;
		const shown = bodyForDisplay(message(0, { body }), 3, 20);

		expect(shown.rows).toBe(3);
		expect(shown.text.split("\n")).toHaveLength(3);
		expect(shown.text.endsWith("…")).toBe(true);
		expect(shown.truncated).toBe(true);
	});

	test("counts newlines as rows, not as characters", () => {
		// Forty characters of "x\n" is well under any character budget, but it draws
		// twenty rows: only a row budget keeps it inside a four-row window.
		const body = "x\n".repeat(20);
		const shown = bodyForDisplay(message(0, { body }), 4, 40);

		expect(shown.rows).toBe(4);
		expect(shown.text.split("\n")).toHaveLength(4);
		expect(shown.text.endsWith("…")).toBe(true);
		expect(shown.truncated).toBe(true);
	});

	test("ignores the body entirely when the pane has no rows left", () => {
		expect(bodyForDisplay(message(0, { body: "something" }), 0, 40)).toEqual({
			text: "",
			truncated: true,
			rows: 0,
		});
	});
});

describe("attachmentsForDisplay", () => {
	const file = (index: number) => ({
		id: `a${index}`,
		contentType: "image/png",
		filename: `/tmp/file-${index}.png`,
		size: 1024,
		caption: null,
		isVoiceNote: false,
	});

	test("renders every file when they all fit", () => {
		const shown = attachmentsForDisplay(
			message(0, { body: "", attachments: [file(1), file(2)] }),
			10,
			40,
		);
		expect(shown.omitted).toBe(0);
		expect(shown.lines).toHaveLength(2);
		expect(shown.rows).toBe(2);
	});

	test("gives up a file line to make room for the count", () => {
		// Three files, two rows: one file plus a marker, not two files and no marker.
		const shown = attachmentsForDisplay(
			message(0, { body: "", attachments: [file(1), file(2), file(3)] }),
			2,
			40,
		);
		expect(shown.lines).toHaveLength(1);
		expect(shown.omitted).toBe(2);
		expect(shown.rows).toBe(2);
	});

	test("has nothing to render for a deleted message", () => {
		const shown = attachmentsForDisplay(
			message(0, { isDeleted: true, attachments: [file(1)] }),
			5,
			40,
		);
		expect(shown).toEqual({ lines: [], omitted: 0, rows: 0 });
	});
});
