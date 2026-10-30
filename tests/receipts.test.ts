import { describe, expect, test } from "bun:test";
import { headerLine } from "../src/domain/format";
import {
	receiptFromRank,
	receiptMarker,
	receiptRank,
	strongerReceipt,
} from "../src/domain/receipts";
import type { Message } from "../src/domain/types";
import { stubClock } from "./helpers/clock";

const message = (overrides: Partial<Message> = {}): Message => ({
	id: "m1",
	conversationId: "c1",
	author: "You",
	body: "hi",
	sentAt: 0,
	isOutgoing: true,
	isDeleted: false,
	...overrides,
});

const clock = stubClock();

describe("the receipt ladder", () => {
	test("ranks delivered below read below viewed", () => {
		expect(receiptRank("delivered")).toBeLessThan(receiptRank("read"));
		expect(receiptRank("read")).toBeLessThan(receiptRank("viewed"));
	});

	test("a receipt only ever strengthens what is stored", () => {
		// The whole point: receipts arrive out of order, so a delivery that lands
		// after a read must not turn two ticks back into one.
		expect(strongerReceipt("read", "delivered")).toBe("read");
		expect(strongerReceipt("viewed", "read")).toBe("viewed");
		expect(strongerReceipt("delivered", "read")).toBe("read");
		expect(strongerReceipt("read", "read")).toBe("read");
	});

	test("nothing acknowledged yet still takes the first receipt it gets", () => {
		expect(strongerReceipt(undefined, "delivered")).toBe("delivered");
		expect(strongerReceipt(undefined, "viewed")).toBe("viewed");
	});

	test("a rank reads back as its state, and an empty or unknown rank as none", () => {
		expect(receiptFromRank(1)).toBe("delivered");
		expect(receiptFromRank(2)).toBe("read");
		expect(receiptFromRank(3)).toBe("viewed");
		// 0 is the column default, i.e. the row was written before a receipt arrived.
		expect(receiptFromRank(0)).toBeUndefined();
		expect(receiptFromRank(null)).toBeUndefined();
		expect(receiptFromRank(99)).toBeUndefined();
	});
});

describe("receipt ticks", () => {
	test("one tick once delivered, two once read", () => {
		expect(receiptMarker(message({ receipt: "delivered" }))).toBe(" ✓");
		expect(receiptMarker(message({ receipt: "read" }))).toBe(" ✓✓");
		// A viewed receipt only arrives for a view-once message, which was also read.
		expect(receiptMarker(message({ receipt: "viewed" }))).toBe(" ✓✓");
	});

	test("no ticks for a message nobody acknowledged", () => {
		expect(receiptMarker(message())).toBe("");
	});

	test("no ticks on an incoming message", () => {
		// Guards the field itself: a receipt is about what we sent, so an attached one
		// on a peer's message must stay invisible rather than claim they read us.
		expect(receiptMarker(message({ isOutgoing: false, receipt: "read" }))).toBe("");
	});

	test("the header row carries the ticks after the author", () => {
		expect(headerLine(message({ receipt: "read" }), clock)).toBe("10:00 You ✓✓");
		expect(headerLine(message({ receipt: "delivered", isEdited: true }), clock)).toBe(
			"10:00 You · edited ✓",
		);
		expect(headerLine(message(), clock)).toBe("10:00 You");
	});
});
