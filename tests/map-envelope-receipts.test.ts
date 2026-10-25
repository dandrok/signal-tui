import { describe, expect, test } from "bun:test";
import { mapEnvelope } from "../src/adapters/signal/map-envelope";
import type { Envelope, ReceiptMessage } from "../src/adapters/signal/schemas";

const envelope = (overrides: Partial<Envelope> = {}): Envelope => ({
	source: "+100****0000",
	sourceNumber: "+100****0000",
	sourceUuid: "b5b0c3d2-0000-4000-8000-000000000000",
	sourceName: "Alice",
	sourceDevice: 1,
	timestamp: 1_759_999_999_000,
	...overrides,
});

const receipt = (overrides: Partial<ReceiptMessage> = {}): ReceiptMessage => ({
	when: 1_760_000_000_000,
	isDelivery: false,
	isRead: false,
	isViewed: false,
	timestamps: [1_759_999_998_000],
	...overrides,
});

/**
 * A receipt is an acknowledgement, not a message: it names what we sent by
 * timestamp and says how far it got.
 */
describe("mapEnvelope receipts", () => {
	test("maps a read receipt to the messages it acknowledges", () => {
		const mapped = mapEnvelope(
			envelope({ receiptMessage: receipt({ isRead: true, timestamps: [500, 600] }) }),
		);

		expect(mapped.receipt).toEqual({ timestamps: [500, 600], state: "read" });
		// Nothing may be inserted for a receipt: the messages already exist locally.
		expect(mapped.message).toBeNull();
		expect(mapped.conversation).toBeNull();
		expect(mapped.deleted).toBeNull();
		expect(mapped.edited).toBeNull();
	});

	test("maps delivery and viewed receipts", () => {
		expect(
			mapEnvelope(envelope({ receiptMessage: receipt({ isDelivery: true }) })).receipt?.state,
		).toBe("delivered");
		// Upstream the three flags are one enum; viewed outranks read when both appear.
		expect(
			mapEnvelope(envelope({ receiptMessage: receipt({ isViewed: true, isRead: true }) })).receipt
				?.state,
		).toBe("viewed");
	});

	test("ignores a receipt whose flags are all false", () => {
		// A type this build does not know: guessing would put a tick on a message
		// nobody confirmed.
		expect(mapEnvelope(envelope({ receiptMessage: receipt() })).receipt).toBeNull();
	});

	test("ignores a receipt that names no message", () => {
		expect(
			mapEnvelope(envelope({ receiptMessage: receipt({ isRead: true, timestamps: [] }) })).receipt,
		).toBeNull();
		// signal-cli's `List<Long>` serialises as null when there is nothing to list.
		expect(
			mapEnvelope(envelope({ receiptMessage: receipt({ isRead: true, timestamps: null }) }))
				.receipt,
		).toBeNull();
	});
});
