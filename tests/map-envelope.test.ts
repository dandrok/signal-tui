import { describe, expect, test } from "bun:test";
import { mapEnvelope, peerId, peerName } from "../src/adapters/signal/map-envelope";
import type { Envelope } from "../src/adapters/signal/schemas";

const envelope = (overrides: Partial<Envelope> = {}): Envelope => ({
	source: "+10000000000",
	sourceNumber: "+10000000000",
	sourceUuid: "b5b0c3d2-0000-4000-8000-000000000000",
	sourceName: "Alice",
	sourceDevice: 1,
	timestamp: 1_759_999_999_000,
	...overrides,
});

const withData = (dataMessage: Record<string, unknown>): Envelope =>
	envelope({ dataMessage: dataMessage as Envelope["dataMessage"] });

describe("peerId / peerName", () => {
	test("prefers the uuid for identity and the display name for the label", () => {
		expect(peerId(envelope())).toBe("b5b0c3d2-0000-4000-8000-000000000000");
		expect(peerName(envelope())).toBe("Alice");
	});

	test("falls back through number and uuid when there is no name", () => {
		expect(peerId(envelope({ sourceUuid: undefined }))).toBe("+10000000000");
		expect(peerName(envelope({ sourceName: undefined }))).toBe("+10000000000");
		expect(peerName(envelope({ sourceName: undefined, sourceNumber: undefined }))).toBe(
			"b5b0c3d2-0000-4000-8000-000000000000",
		);
	});

	test("returns null when the envelope has no identifiers", () => {
		expect(
			peerId(envelope({ sourceUuid: undefined, sourceNumber: undefined, source: undefined })),
		).toBeNull();
	});
});

describe("mapEnvelope", () => {
	test("maps a text message into a domain message and conversation", () => {
		const mapped = mapEnvelope(
			withData({ timestamp: 1_760_000_000_000, message: "pushed the fix" }),
		);

		expect(mapped.message).toEqual({
			id: "b5b0c3d2-0000-4000-8000-000000000000:1760000000000",
			conversationId: "b5b0c3d2-0000-4000-8000-000000000000",
			author: "Alice",
			body: "pushed the fix",
			sentAt: 1_760_000_000_000,
			isOutgoing: false,
			isDeleted: false,
		});
		expect(mapped.conversation).toEqual({
			id: "b5b0c3d2-0000-4000-8000-000000000000",
			name: "Alice",
			unreadCount: 1,
			lastActivityAt: 1_760_000_000_000,
		});
	});

	test("shows a placeholder when the message is attachments only", () => {
		const mapped = mapEnvelope(
			withData({ timestamp: 1, attachments: [{ id: "att-1", contentType: "image/png" }] }),
		);
		expect(mapped.message?.body).toBe("[attachment]");
	});

	test("keeps an empty body for a message with neither text nor attachments", () => {
		expect(mapEnvelope(withData({ timestamp: 1 })).message?.body).toBe("");
	});

	test("marks remotely deleted messages", () => {
		const mapped = mapEnvelope(
			withData({ timestamp: 1, message: "gone", remoteDelete: { timestamp: 2 } }),
		);
		expect(mapped.message?.isDeleted).toBe(true);
	});

	test("returns nothing for envelopes without a data message", () => {
		const mapped = mapEnvelope(envelope({ typingMessage: { type: "STARTED" } }));
		expect(mapped).toEqual({ message: null, conversation: null });
	});

	test("returns nothing when the sender cannot be identified", () => {
		const nameless = withData({ timestamp: 1, message: "hi" });
		const anonymous: Envelope = {
			timestamp: 1,
			dataMessage: nameless.dataMessage,
		};
		expect(mapEnvelope(anonymous)).toEqual({ message: null, conversation: null });
	});
});
