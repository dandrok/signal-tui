import { describe, expect, test } from "bun:test";
import type { Conversation, Message } from "../src/domain/types";
import { MessagePane } from "../src/ui/message-pane";
import { stubClock } from "./helpers/clock";
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
	author: "You",
	body: "on my way",
	sentAt: 0,
	isOutgoing: true,
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
			// A stub clock: real ICU renders midnight as 00:00 here and 24:00 on the
			// owner's machine, which is a layout test failing for the wrong reason.
			clock={stubClock()}
		/>,
	);

describe("MessagePane receipts", () => {
	test("draws the ticks on our own message", () => {
		expect(frameOf([message({ receipt: "read" })])).toContain("10:00 You ✓✓");
		expect(frameOf([message({ receipt: "delivered" })])).toContain("10:00 You ✓");
	});

	test("draws no ticks for a message nobody acknowledged", () => {
		const frame = frameOf([message()]);
		expect(frame).toContain("10:00 You");
		expect(frame).not.toContain("✓");
	});

	test("the ticks ride the author row instead of costing one", () => {
		// Equality is the claim: a marker that took a row of its own would push the
		// window one row taller and change this count.
		const without = frameOf([message()]);
		const withReceipt = frameOf([message({ receipt: "read" })]);
		const rows = (frame: string): number =>
			frame.split("\n").filter((line) => line.trim().length > 0).length;

		expect(rows(withReceipt)).toBe(rows(without));
		// The frame is clipped to the box, so also assert the header survived: with
		// `justifyContent="flex-end"` an overflow would have eaten the top row.
		expect(withReceipt).toContain("10:00 You ✓✓");
		expect(withReceipt).toContain("on my way");
	});

	test("keeps a very long body from clipping the ticks away", () => {
		const long = "line of text ".repeat(200);
		const frame = frameOf([message({ body: long, receipt: "delivered" })]);
		expect(frame).toContain("10:00 You ✓");
	});
});
