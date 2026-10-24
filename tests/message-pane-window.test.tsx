import { describe, expect, test } from "bun:test";
import { render } from "ink-testing-library";
import type { Conversation, Message } from "../src/domain/types";
import { clockFor } from "../src/ui/clock";
import { MessagePane } from "../src/ui/MessagePane";

const utc = clockFor("UTC");

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

describe("MessagePane window", () => {
	test("shows the newest messages and says how many are above", () => {
		const { lastFrame, unmount } = render(
			<MessagePane
				conversation={conversation(0)}
				messages={many(8)}
				height={8}
				width={60}
				clock={utc}
			/>,
		);
		const frame = lastFrame() ?? "";
		unmount();

		expect(frame).toContain("body-7");
		expect(frame).toContain("↑ 6 older");
	});

	test("scrolled up, the window shows older text and the count shrinks", () => {
		const { lastFrame, unmount } = render(
			<MessagePane
				conversation={conversation(0)}
				messages={many(8)}
				height={8}
				width={60}
				scroll={2}
				clock={utc}
			/>,
		);
		const frame = lastFrame() ?? "";
		unmount();

		expect(frame).toContain("body-5");
		expect(frame).not.toContain("body-7");
		expect(frame).toContain("↑ 4 older");
	});

	test("says nothing about older messages when the whole thread fits", () => {
		const { lastFrame, unmount } = render(
			<MessagePane
				conversation={conversation(0)}
				messages={many(2)}
				height={12}
				width={60}
				clock={utc}
			/>,
		);
		const frame = lastFrame() ?? "";
		unmount();

		expect(frame).not.toContain("older");
	});

	test("reserves a row for the older label instead of clipping the newest message", () => {
		// Four content rows. Two messages plus the label would be five, so the
		// window has to give up a message — otherwise ink clips the bottom line,
		// which is the newest message's body.
		const { lastFrame, unmount } = render(
			<MessagePane
				conversation={conversation(0)}
				messages={many(8)}
				height={7}
				width={60}
				clock={utc}
			/>,
		);
		const frame = lastFrame() ?? "";
		unmount();

		expect(frame).toContain("↑ 7 older");
		expect(frame).toContain("body-7");
		expect(frame).not.toContain("body-6");
	});

	test("keeps a message's files visible under an oversized body", () => {
		const withFile = message(0, {
			body: "y".repeat(2000),
			attachments: [
				{
					id: "a1",
					contentType: "application/pdf",
					filename: "/tmp/report.pdf",
					size: 1024,
					caption: null,
					isVoiceNote: false,
				},
			],
		});
		const { lastFrame, unmount } = render(
			<MessagePane
				conversation={conversation(0)}
				messages={[withFile]}
				height={8}
				width={60}
				clock={utc}
			/>,
		);
		const frame = lastFrame() ?? "";
		unmount();

		// Everything the pane draws has to fit its eight rows: title, borders, and
		// the five content rows shared by header, body and file line. Budgeting the
		// body with every content row overflows, and ink clips from the top — the
		// header is what disappears first.
		expect(frame).toContain("00:00 Marta");
		expect(frame).toContain("report.pdf");
		expect(frame).toContain("…");
		expect(frame.split("\n").filter((line) => line.length > 0)).toHaveLength(8);
	});

	test("renders clocks in the zone it is given", () => {
		const at = [message(0, { sentAt: Date.UTC(2026, 9, 24, 7, 4) })];
		const inZone = (timeZone: string): string => {
			const { lastFrame, unmount } = render(
				<MessagePane
					conversation={conversation(0)}
					messages={at}
					height={8}
					width={60}
					clock={clockFor(timeZone)}
				/>,
			);
			const frame = lastFrame() ?? "";
			unmount();
			return frame;
		};

		expect(inZone("UTC")).toContain("07:04");
		expect(inZone("Europe/Warsaw")).toContain("09:04");
	});

	test("keeps the row budget when the older label takes one", () => {
		// A window re-measured with one row less must not hand the body the old
		// budget: with the label plus an oversized newest message the pane would
		// draw six rows into five and ink would clip the header off the top.
		const messages = [message(1, { body: "small" }), message(2, { body: "z".repeat(4000) })];
		const { lastFrame, unmount } = render(
			<MessagePane
				conversation={conversation(0)}
				messages={messages}
				height={8}
				width={60}
				clock={utc}
			/>,
		);
		const frame = lastFrame() ?? "";
		unmount();

		expect(frame).toContain("↑ 1 older");
		expect(frame).toContain("Marta");
		expect(frame).toContain("…");
		expect(frame.split("\n").filter((line) => line.length > 0)).toHaveLength(8);
	});

	test("says how many files did not fit instead of letting ink clip them", () => {
		const attachment = (index: number) => ({
			id: `a${index}`,
			contentType: "image/png",
			filename: `/tmp/file-${index}.png`,
			size: 1024,
			caption: null,
			isVoiceNote: false,
		});
		const withFiles = [
			message(0, {
				body: "w".repeat(4000),
				attachments: [attachment(1), attachment(2), attachment(3), attachment(4)],
			}),
		];
		const { lastFrame, unmount } = render(
			<MessagePane
				conversation={conversation(0)}
				messages={withFiles}
				height={7}
				width={60}
				clock={utc}
			/>,
		);
		const frame = lastFrame() ?? "";
		unmount();

		// Four content rows: header, two file lines, one row for the marker. The body
		// has nothing left, and the files that did not fit are counted, not clipped.
		expect(frame).toContain("file-1.png");
		expect(frame).toContain("file-2.png");
		expect(frame).toContain("+2 more files");
		expect(frame).not.toContain("file-4.png");
		expect(frame).not.toContain("wwww");
	});

	test("drops the file marker when no row is left to show it", () => {
		// height 5 leaves two content rows; the older label takes one, so the message
		// budget is a single row. A marker with no row reserved for it would push the
		// title and the label off the top of the pane under flex-end.
		const withFiles = [
			message(1, { body: "small" }),
			message(2, {
				body: "",
				attachments: [
					{
						id: "a1",
						contentType: "image/png",
						filename: "/tmp/a.png",
						size: 1,
						caption: null,
						isVoiceNote: false,
					},
					{
						id: "a2",
						contentType: "image/png",
						filename: "/tmp/b.png",
						size: 1,
						caption: null,
						isVoiceNote: false,
					},
				],
			}),
		];
		const { lastFrame, unmount } = render(
			<MessagePane
				conversation={conversation(0)}
				messages={withFiles}
				height={5}
				width={60}
				clock={utc}
			/>,
		);
		const frame = lastFrame() ?? "";
		unmount();

		expect(frame).toContain("Person 0");
		expect(frame).toContain("↑ 1 older");
		expect(frame).toContain("Marta");
		expect(frame).not.toContain("more");
		expect(frame.split("\n").filter((line) => line.length > 0)).toHaveLength(5);
	});

	test("draws only the rows a single oversized message can fill", () => {
		// ink wraps whatever string it is given, on every frame: a body far taller
		// than the pane is cut, and the cut is visible rather than silent.
		const huge = [message(0, { body: `START${"x".repeat(4000)}ENDTAG` })];
		const { lastFrame, unmount } = render(
			<MessagePane
				conversation={conversation(0)}
				messages={huge}
				height={8}
				width={60}
				clock={utc}
			/>,
		);
		const frame = lastFrame() ?? "";
		unmount();

		expect(frame).toContain("START");
		expect(frame).toContain("…");
		expect(frame).not.toContain("ENDTAG");
	});
});
