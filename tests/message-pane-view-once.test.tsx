import { describe, expect, test } from "bun:test";
import type { Conversation, Message } from "../src/domain/types";
import { MessagePane } from "../src/ui/MessagePane";
import { frameOf as renderFrame } from "./helpers/frame";

const conversation: Conversation = {
	id: "c1",
	name: "Marta",
	unreadCount: 0,
	lastActivityAt: 0,
};

const message = (overrides: Partial<Message> = {}): Message => ({
	id: "m1",
	conversationId: "c1",
	author: "Marta",
	body: "",
	sentAt: 0,
	isOutgoing: false,
	isDeleted: false,
	...overrides,
});

const frameOf = (messages: readonly Message[]): string =>
	renderFrame(
		<MessagePane
			conversation={conversation}
			messages={messages}
			height={20}
			width={60}
			clock={() => "10:00"}
		/>,
	);

describe("MessagePane view-once", () => {
	test("says the message was view-once instead of drawing an empty row", () => {
		const frame = frameOf([message({ isViewOnce: true })]);
		expect(frame).toContain("10:00 Marta");
		expect(frame).toContain("view-once message · not stored");
	});

	test("no caption or filename is drawn for it", () => {
		// Even if a caller hands over content, the pane must not show it: the row is the
		// notice, nothing else.
		const frame = frameOf([
			message({
				isViewOnce: true,
				body: "look at this",
				attachments: [
					{
						id: "a1",
						contentType: "image/jpeg",
						filename: "/tmp/holiday.jpg",
						size: 812_000,
						caption: "holiday snap",
						isVoiceNote: false,
					},
				],
			}),
		]);

		expect(frame).not.toContain("holiday");
		expect(frame).not.toContain("look at this");
	});

	test("an ordinary message with no text still draws no notice", () => {
		expect(frameOf([message({ body: "hello" })])).not.toContain("view-once");
	});
});
