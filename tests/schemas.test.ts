import { describe, expect, test } from "bun:test";
import {
	dataMessageSchema,
	envelopeSchema,
	receiptMessageSchema,
	receiveEnvelopeSchema,
	typingMessageSchema,
} from "../src/adapters/signal/schemas";

const dataMessageFixture = {
	timestamp: 1_760_000_000_000,
	message: "pushed the fix, ptal",
	attachments: [{ id: "att-1", contentType: "image/png", size: 2048, width: 640, height: 480 }],
	quote: {
		id: 1_759_999_000_000,
		author: "+10000000000",
		text: "attachments path also needs the limit",
	},
	reaction: { emoji: "👍", targetAuthor: "+10000000000", targetTimestamp: 1_759_999_000_000 },
	mentions: [{ start: 0, length: 5, author: "+10000000001" }],
	expiresInSeconds: 3600,
};

describe("dataMessageSchema", () => {
	test("parses a realistic payload", () => {
		const parsed = dataMessageSchema.parse(dataMessageFixture);
		expect(parsed.message).toBe("pushed the fix, ptal");
		expect(parsed.attachments?.[0]?.contentType).toBe("image/png");
		expect(parsed.quote?.text).toContain("attachments path");
		expect(parsed.reaction?.emoji).toBe("👍");
		expect(parsed.expiresInSeconds).toBe(3600);
	});

	test("requires a timestamp", () => {
		const { timestamp, ...withoutTimestamp } = dataMessageFixture;
		expect(timestamp).toBeDefined();
		expect(dataMessageSchema.safeParse(withoutTimestamp).success).toBe(false);
	});

	test("rejects a wrong attachment field type", () => {
		const broken = { ...dataMessageFixture, attachments: [{ size: "2048" }] };
		expect(dataMessageSchema.safeParse(broken).success).toBe(false);
	});

	test("keeps unknown fields instead of stripping them", () => {
		const parsed = dataMessageSchema.parse({
			...dataMessageFixture,
			futureField: { nested: true },
		});
		expect((parsed as Record<string, unknown>).futureField).toEqual({ nested: true });
	});

	test("accepts an edit whose replacement content is opaque", () => {
		const edited = {
			timestamp: 1_760_000_000_001,
			editMessage: {
				targetSentTimestamp: 1_760_000_000_000,
				dataMessage: { message: "fixed typo" },
			},
		};
		expect(dataMessageSchema.safeParse(edited).success).toBe(true);
	});
});

describe("receiptMessageSchema", () => {
	test("requires the three flag booleans", () => {
		expect(
			receiptMessageSchema.safeParse({ when: 1, isDelivery: true, isRead: false, isViewed: false })
				.success,
		).toBe(true);
		expect(receiptMessageSchema.safeParse({ when: 1, isDelivery: true }).success).toBe(false);
	});
});

describe("typingMessageSchema", () => {
	test("accepts the documented states as an open string", () => {
		expect(typingMessageSchema.safeParse({ type: "STARTED" }).success).toBe(true);
		expect(typingMessageSchema.safeParse({ type: "SOMETHING_NEW" }).success).toBe(true);
		expect(typingMessageSchema.safeParse({ type: 42 }).success).toBe(false);
	});
});

describe("envelopeSchema", () => {
	test("parses an envelope carrying a data message", () => {
		const envelope = {
			source: "+10000000000",
			sourceNumber: "+10000000000",
			sourceUuid: "4b1c9f1e-0000-4000-8000-000000000000",
			sourceDevice: 1,
			timestamp: 1_760_000_000_500,
			dataMessage: dataMessageFixture,
		};
		const parsed = envelopeSchema.parse(envelope);
		expect(parsed.dataMessage?.message).toBe("pushed the fix, ptal");
	});

	test("requires an envelope timestamp", () => {
		expect(envelopeSchema.safeParse({ source: "+10000000000" }).success).toBe(false);
	});

	test("parses a receive wrapper", () => {
		const wrapper = {
			account: "+10000000000",
			envelope: { timestamp: 1, typingMessage: { type: "STOPPED" } },
		};
		expect(receiveEnvelopeSchema.safeParse(wrapper).success).toBe(true);
	});

	test("leaves unmodelled envelope kinds as opaque", () => {
		const parsed = envelopeSchema.parse({
			timestamp: 1,
			syncMessage: { sentMessage: { message: "hi" } },
		});
		expect(parsed.syncMessage).toEqual({ sentMessage: { message: "hi" } });
	});
});
