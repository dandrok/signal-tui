import { describe, expect, test } from "bun:test";
import {
	conversationTarget,
	mapEnvelope,
	peerId,
	peerName,
} from "../src/adapters/signal/map-envelope";
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

const withData = (
	dataMessage: Record<string, unknown>,
	overrides: Partial<Envelope> = {},
): Envelope => envelope({ ...overrides, dataMessage: dataMessage as Envelope["dataMessage"] });

const groupData = (message: string, timestamp = 3): Record<string, unknown> => ({
	timestamp,
	message,
	groupInfo: { groupId: "group-1", groupName: "Signal devs" },
});

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

describe("conversationTarget", () => {
	test("keys a group message by group id, not by sender", () => {
		expect(conversationTarget(withData(groupData("hi")))).toEqual({
			id: "group-1",
			name: "Signal devs",
			kind: "group",
		});
	});

	test("falls back to a generic label for unnamed groups", () => {
		const unnamed = withData({ timestamp: 1, message: "hi", groupInfo: { groupId: "group-2" } });
		expect(conversationTarget(unnamed)).toEqual({ id: "group-2", name: "Group", kind: "group" });
	});

	test("keys a direct message by peer identity", () => {
		expect(conversationTarget(withData({ timestamp: 1, message: "hi" }))).toEqual({
			id: "b5b0c3d2-0000-4000-8000-000000000000",
			name: "Alice",
			kind: "direct",
		});
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
		expect(mapped.conversationKind).toBe("direct");
		expect(mapped.deleted).toBeNull();
	});

	test("puts messages from different group members into one conversation", () => {
		const fromAlice = mapEnvelope(
			withData(groupData("one"), { sourceUuid: "uuid-a", sourceName: "Alice" }),
		);
		const fromBob = mapEnvelope(
			withData(groupData("two"), { sourceUuid: "uuid-b", sourceName: "Bob" }),
		);

		expect(fromAlice.conversation?.id).toBe("group-1");
		expect(fromBob.conversation?.id).toBe("group-1");
		expect(fromAlice.conversationKind).toBe("group");
		expect(fromBob.message?.author).toBe("Bob");
	});

	test("shows a placeholder when the message is attachments only", () => {
		const mapped = mapEnvelope(
			withData({
				timestamp: 1,
				attachments: [{ id: "att-1", contentType: "image/png", isVoiceNote: false }],
			}),
		);
		expect(mapped.message?.body).toBe("[attachment]");
	});

	test("keeps an empty body for a message with neither text nor attachments", () => {
		expect(mapEnvelope(withData({ timestamp: 1 })).message?.body).toBe("");
	});

	test("maps a remote delete to the message it removes, not to a new one", () => {
		const mapped = mapEnvelope(
			withData({ timestamp: 9_000, message: "gone", remoteDelete: { timestamp: 1_000 } }),
		);

		expect(mapped.message).toBeNull();
		expect(mapped.conversation).toBeNull();
		expect(mapped.deleted).toEqual({
			conversationId: "b5b0c3d2-0000-4000-8000-000000000000",
			messageId: "b5b0c3d2-0000-4000-8000-000000000000:1000",
		});
	});

	test("returns nothing for envelopes without a data message", () => {
		const mapped = mapEnvelope(envelope({ typingMessage: { action: "STARTED", timestamp: 1 } }));
		expect(mapped).toEqual({
			message: null,
			conversation: null,
			conversationKind: "direct",
			deleted: null,
		});
	});

	test("returns nothing when the sender cannot be identified", () => {
		const anonymous: Envelope = { timestamp: 1, dataMessage: { timestamp: 1, message: "hi" } };
		expect(mapEnvelope(anonymous)).toEqual({
			message: null,
			conversation: null,
			conversationKind: "direct",
			deleted: null,
		});
	});
});
