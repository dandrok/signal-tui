import { describe, expect, test } from "bun:test";
import type { Clock } from "../src/domain/format";
import { continuesAuthorRun, messageRowCount } from "../src/domain/rows";
import type { Conversation, Message } from "../src/domain/types";
import { MessagePane } from "../src/ui/message-pane";
import { frameOf } from "./helpers/frame";

/**
 * How a thread says who is speaking, and how it stops saying it.
 *
 * Two rules are pinned here because both are invisible when they break: a burst from one author
 * draws one header instead of one per message, and your own messages carry a bar in the gutter.
 * Neither is a colour assertion — the bar is a glyph, and the counts are rows.
 */

const clock: Clock = () => "10:00";
const MINUTE = 60_000;

const conversation: Conversation = { id: "c1", name: "Marta", unreadCount: 0, lastActivityAt: 0 };

const message = (index: number, overrides: Partial<Message> = {}): Message => ({
	id: `m-${index}`,
	conversationId: "c1",
	author: "Marta",
	body: `body-${index}`,
	sentAt: index * MINUTE,
	isOutgoing: false,
	isDeleted: false,
	...overrides,
});

const pane = (messages: readonly Message[], cursorId?: string): string =>
	frameOf(
		<MessagePane
			conversation={conversation}
			messages={messages}
			height={20}
			width={60}
			clock={clock}
			cursorId={cursorId}
		/>,
	);

/** How many times `needle` is drawn, which is the only thing a header test can measure. */
const occurrences = (frame: string, needle: string): number => frame.split(needle).length - 1;

describe("a run of messages from one author", () => {
	test("draws one header for the whole burst", () => {
		const frame = pane([message(0), message(1), message(2)]);

		// The pane's own title is "Marta (3)", so a header is counted as clock + author.
		expect(occurrences(frame, "10:00 Marta")).toBe(1);
		expect(frame).toContain("body-0");
		expect(frame).toContain("body-2");
	});

	test("starts a new block once the gap passes five minutes", () => {
		// Two messages that must fold, then one six minutes after the second: two headers, not
		// three. Without the eligible pair this case passes with the folding deleted.
		const frame = pane([
			message(0),
			message(1, { body: "still the same burst" }),
			message(7, { body: "later" }),
		]);

		expect(occurrences(frame, "10:00 Marta")).toBe(2);
		expect(frame).toContain("still the same burst");
		expect(frame).toContain("later");
	});

	test("tells two people with the same display name apart by their sender id", () => {
		// Folding on the label alone would credit one group member with the other's words.
		const frame = pane([
			message(0, { author: "Marta", authorId: "uuid-marta-a" }),
			message(1, { author: "Marta", authorId: "uuid-marta-b", body: "different person" }),
		]);

		expect(occurrences(frame, "10:00 Marta")).toBe(2);
	});

	test("folds rows that carry the same sender id, whatever the label", () => {
		// A transcript names the same person differently over time; the id is what matters.
		const frame = pane([
			message(0, { author: "Marta", authorId: "uuid-marta" }),
			message(1, { author: "Marta K.", authorId: "uuid-marta", body: "same person" }),
		]);

		expect(occurrences(frame, "10:00 ")).toBe(1);
	});

	test("never folds a message somebody reacted to", () => {
		// The reaction marker is drawn on the header row and nowhere else, so folding that row
		// away would hide the answer from the thread entirely.
		const frame = pane([
			message(0),
			message(1, {
				body: "reacted to",
				reactions: [{ emoji: "❤️", author: "Alice", authorId: "uuid-alice" }],
			}),
		]);

		expect(occurrences(frame, "10:00 Marta")).toBe(2);
	});

	test("starts a new block when the author changes", () => {
		const frame = pane([message(0), message(1, { author: "Alice", body: "hi" })]);

		expect(frame).toContain("Marta");
		expect(frame).toContain("Alice");
	});

	test("never folds a deleted row into the block above it", () => {
		// The label of a deleted row is the word "deleted", which names no author: folding it in
		// would hide the only sign that something used to be there.
		const frame = pane([message(0), message(1, { isDeleted: true })]);

		expect(frame).toContain("10:00 deleted");
		expect(occurrences(frame, "10:00 Marta")).toBe(1);
	});

	test("is one row cheaper when folded, which is what the window measures", () => {
		const second = message(1);
		const folded = messageRowCount(second, 40, clock, 20, undefined, "", message(0));
		const own = messageRowCount(second, 40, clock, 20, undefined, "", undefined);

		expect(folded).toBe(own - 1);
	});

	test("keeps the header of the message a reply would answer", () => {
		// `▸` is the only thing pointing at the row `r` answers, so folding it away would leave
		// the cursor on a row with nothing marking it.
		const frame = pane([message(0), message(1)], "m-1");

		expect(frame).toContain("▸");
		expect(occurrences(frame, "10:00 Marta")).toBe(2);
	});

	test("follows the two-message order, not the clock backwards", () => {
		// An out-of-order pair must not fold: `gap >= 0` is part of the rule.
		expect(continuesAuthorRun(message(5), message(1))).toBe(false);
		expect(continuesAuthorRun(message(1), message(2))).toBe(true);
		expect(continuesAuthorRun(undefined, message(1))).toBe(false);
	});
});

describe("the gutter", () => {
	test("marks your messages and leaves the other side's alone", () => {
		const frame = pane([message(0), message(1, { isOutgoing: true, author: "You", body: "mine" })]);
		const barred = frame.split("\n").filter((line) => line.includes("▌"));

		// The header and the body of one own message, and nothing else.
		expect(barred).toHaveLength(2);
		expect(barred.every((line) => line.includes("You") || line.includes("mine"))).toBe(true);
		expect(frame).toContain("body-0");
	});

	test("keeps the bar on every line of a body that wrapped", () => {
		const long = "w".repeat(200);
		const frame = pane([message(0, { isOutgoing: true, author: "You", body: long })]);
		const barred = frame.split("\n").filter((line) => line.includes("▌"));

		// Every row of the block carries the bar: the header, then each row the body wrapped into.
		expect(barred.length).toBeGreaterThan(2);
		expect(barred[0]).toContain("You");
		expect(barred.slice(1).every((line) => line.includes("w"))).toBe(true);
	});

	test("keeps the bar on every row of an attachment name that wrapped", () => {
		const frame = frameOf(
			<MessagePane
				conversation={conversation}
				messages={[
					message(0, {
						isOutgoing: true,
						author: "You",
						body: "",
						attachments: [
							{
								id: null,
								contentType: "application/pdf",
								filename: `/tmp/${"quarterly-report-".repeat(3)}final.pdf`,
								size: 2048,
								caption: null,
								isVoiceNote: false,
							},
						],
					}),
				]}
				height={20}
				width={46}
				clock={clock}
			/>,
		);
		const barred = frame.split("\n").filter((line) => line.includes("▌"));

		expect(barred.length).toBeGreaterThan(2);
		expect(barred.slice(1).every((line) => line.includes("📎") || line.includes("-"))).toBe(true);
	});

	test("keeps the bar on a header that wrapped into several rows", () => {
		// Six reaction markers at the narrowest pane push the header past the width, and the row is
		// then drawn from the cut text — which is several rows, each of which needs its bar.
		const reactions = ["❤️", "👍", "🎉", "😄", "🙏", "👀"].map((emoji, index) => ({
			emoji,
			author: `Person ${index}`,
			authorId: `uuid-${index}`,
		}));
		const frame = frameOf(
			<MessagePane
				conversation={conversation}
				messages={[message(0, { isOutgoing: true, author: "You", body: "one", reactions })]}
				height={20}
				width={30}
				clock={clock}
			/>,
		);
		// Every row inside the pane that draws something, title excluded: blank rows are the pane's
		// own padding and belong to no message.
		const content = frame
			.split("\n")
			.filter(
				(line) =>
					line.startsWith("│ ") && line.slice(1, -1).trim() !== "" && !line.includes("Marta (1)"),
			);

		expect(content.length).toBeGreaterThan(2);
		expect(content.every((line) => line.includes("▌"))).toBe(true);
		// One header, wrapped: the clock is printed once even though it occupies two rows.
		expect(occurrences(frame, "10:00")).toBe(1);
	});

	test("marks a folded own message even though it draws no header", () => {
		const frame = pane([
			message(0, { isOutgoing: true, author: "You", body: "one" }),
			message(1, { isOutgoing: true, author: "You", body: "two" }),
		]);

		expect(occurrences(frame, "10:00 You")).toBe(1);
		expect(frame.split("\n").filter((line) => line.includes("▌"))).toHaveLength(3);
	});
});
