import { describe, expect, test } from "bun:test";
import { render } from "ink-testing-library";
import type { Conversation, Message } from "../src/domain/types";
import { MessagePane } from "../src/ui/MessagePane";

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
				timeZone="UTC"
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
				timeZone="UTC"
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
				timeZone="UTC"
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
				timeZone="UTC"
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
				timeZone="UTC"
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
					timeZone={timeZone}
				/>,
			);
			const frame = lastFrame() ?? "";
			unmount();
			return frame;
		};

		expect(inZone("UTC")).toContain("07:04");
		expect(inZone("Europe/Warsaw")).toContain("09:04");
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
				timeZone="UTC"
			/>,
		);
		const frame = lastFrame() ?? "";
		unmount();

		expect(frame).toContain("START");
		expect(frame).toContain("…");
		expect(frame).not.toContain("ENDTAG");
	});
});
