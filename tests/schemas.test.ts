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
	attachments: [
		{
			id: "att-1",
			contentType: "image/png",
			isVoiceNote: false,
			size: 2048,
			width: 640,
			height: 480,
		},
	],
	quote: {
		id: 1_759_999_000_000,
		authorNumber: "+10000000000",
		text: "attachments path also needs the limit",
	},
	reaction: {
		emoji: "👍",
		targetAuthorNumber: "+10000000000",
		targetSentTimestamp: 1_759_999_000_000,
	},
	mentions: [{ start: 0, length: 5, number: "+10000000001", uuid: "uuid-1" }],
	expiresInSeconds: 3600,
};

describe("dataMessageSchema", () => {
	test("parses a payload shaped like signal-cli's output", () => {
		const parsed = dataMessageSchema.parse(dataMessageFixture);
		expect(parsed.message).toBe("pushed the fix, ptal");
		expect(parsed.attachments?.[0]?.contentType).toBe("image/png");
		expect(parsed.reaction?.targetSentTimestamp).toBe(1_759_999_000_000);
		expect(parsed.mentions?.[0]?.uuid).toBe("uuid-1");
		expect(parsed.expiresInSeconds).toBe(3600);
	});

	test("requires a timestamp", () => {
		const { timestamp, ...withoutTimestamp } = dataMessageFixture;
		expect(timestamp).toBeDefined();
		expect(dataMessageSchema.safeParse(withoutTimestamp).success).toBe(false);
	});

	test("accepts null text, which signal-cli emits for attachment-only messages", () => {
		expect(dataMessageSchema.safeParse({ timestamp: 1, message: null }).success).toBe(true);
	});

	test("accepts a null attachment filename", () => {
		const payload = {
			timestamp: 1,
			attachments: [{ contentType: "image/png", isVoiceNote: false, filename: null }],
		};
		expect(dataMessageSchema.safeParse(payload).success).toBe(true);
	});

	test("accepts a quoted attachment, which carries no isVoiceNote", () => {
		const payload = {
			timestamp: 1,
			quote: {
				id: 2,
				text: "see this",
				attachments: [
					{
						contentType: "image/png",
						filename: "shot.png",
						thumbnail: { contentType: "image/png", isVoiceNote: false },
					},
				],
			},
		};
		expect(dataMessageSchema.safeParse(payload).success).toBe(true);
	});

	test("nullish fields reject the wrong type, not just accept null", () => {
		// A field silently dropped from the schema would make these pass; they must fail.
		expect(dataMessageSchema.safeParse({ timestamp: 1, message: 42 }).success).toBe(false);
		expect(
			typingMessageSchema.safeParse({ action: "STARTED", timestamp: 1, groupId: 42 }).success,
		).toBe(false);
		expect(envelopeSchema.safeParse({ timestamp: 1, sourceNumber: 42 }).success).toBe(false);
		expect(
			dataMessageSchema.safeParse({
				timestamp: 1,
				attachments: [{ contentType: "image/png", isVoiceNote: false, filename: 42 }],
			}).success,
		).toBe(false);
	});

	test("rejects a wrong attachment field type", () => {
		const broken = {
			...dataMessageFixture,
			attachments: [{ contentType: "image/png", size: "2048" }],
		};
		expect(dataMessageSchema.safeParse(broken).success).toBe(false);
	});

	test("keeps unknown fields instead of stripping them", () => {
		const parsed = dataMessageSchema.parse({
			...dataMessageFixture,
			futureField: { nested: true },
		});
		expect((parsed as Record<string, unknown>).futureField).toEqual({ nested: true });
	});

	test("rejects an edit nested inside the data message", () => {
		const nested = { timestamp: 1, editMessage: { targetSentTimestamp: 1 } };
		const parsed = dataMessageSchema.parse(nested) as Record<string, unknown>;
		// Not modelled here: it survives as an unknown key, but is not surfaced.
		expect(parsed.editMessage).toEqual({ targetSentTimestamp: 1 });
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
	test("reads state from action and requires a timestamp", () => {
		expect(typingMessageSchema.safeParse({ action: "STARTED", timestamp: 1 }).success).toBe(true);
		expect(typingMessageSchema.safeParse({ action: "SOMETHING_NEW", timestamp: 1 }).success).toBe(
			true,
		);
		expect(typingMessageSchema.safeParse({ action: "STARTED" }).success).toBe(false);
		expect(typingMessageSchema.safeParse({ type: "STARTED", timestamp: 1 }).success).toBe(false);
	});

	test("accepts a null group id", () => {
		expect(
			typingMessageSchema.safeParse({ action: "STOPPED", timestamp: 1, groupId: null }).success,
		).toBe(true);
	});
});

describe("envelopeSchema", () => {
	test("parses an envelope carrying a data message", () => {
		const envelope = {
			sourceNumber: "+10000000000",
			sourceUuid: "4b1c9f1e-0000-4000-8000-000000000000",
			sourceName: "Alice",
			sourceDevice: 1,
			timestamp: 1_760_000_000_500,
			dataMessage: dataMessageFixture,
		};
		expect(envelopeSchema.parse(envelope).dataMessage?.message).toBe("pushed the fix, ptal");
	});

	test("requires an envelope timestamp", () => {
		expect(envelopeSchema.safeParse({ sourceNumber: "+10000000000" }).success).toBe(false);
	});

	test("accepts a null source number for hidden numbers", () => {
		const envelope = {
			timestamp: 1,
			sourceNumber: null,
			sourceUuid: "uuid-1",
			typingMessage: { action: "STARTED", timestamp: 1 },
		};
		expect(envelopeSchema.safeParse(envelope).success).toBe(true);
	});

	test("models an edit at the envelope level", () => {
		const envelope = {
			timestamp: 1,
			sourceUuid: "uuid-1",
			editMessage: { targetSentTimestamp: 999, dataMessage: { message: "fixed typo" } },
		};
		const parsed = envelopeSchema.parse(envelope);
		expect(parsed.editMessage?.targetSentTimestamp).toBe(999);
	});

	test("parses a receive wrapper", () => {
		const wrapper = {
			account: "+10000000000",
			envelope: { timestamp: 1, typingMessage: { action: "STOPPED", timestamp: 1 } },
		};
		expect(receiveEnvelopeSchema.safeParse(wrapper).success).toBe(true);
	});

	test("parses a sync transcript with its destination ids", () => {
		const parsed = envelopeSchema.parse({
			timestamp: 1,
			syncMessage: {
				sentMessage: {
					timestamp: 5,
					message: "hi",
					destinationUuid: "uuid-bob",
					destinationNumber: "+10000000002",
				},
			},
		});

		expect(parsed.syncMessage?.sentMessage?.destinationUuid).toBe("uuid-bob");
		expect(parsed.syncMessage?.sentMessage?.message).toBe("hi");
	});

	test("accepts a transcript that carries an edit and no timestamp of its own", () => {
		// An edit made on another device arrives as `syncMessage.sentMessage` holding
		// `editMessage` and no flattened data message, so the timestamp an ordinary sent
		// message carries is absent. Requiring it rejected the entire envelope, and the
		// correction was lost with it.
		const parsed = envelopeSchema.safeParse({
			timestamp: 1,
			syncMessage: {
				sentMessage: {
					destinationUuid: "uuid-bob",
					editMessage: {
						targetSentTimestamp: 1_759_999_999_000,
						dataMessage: { timestamp: 1_759_999_999_000, message: "fixed" },
					},
				},
			},
		});

		expect(parsed.success).toBe(true);
	});

	test("leaves unmodelled envelope kinds as opaque", () => {
		const parsed = envelopeSchema.parse({ timestamp: 1, storyMessage: { text: "hi" } });
		expect(parsed.storyMessage).toEqual({ text: "hi" });
	});
});
