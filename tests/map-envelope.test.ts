import { describe, expect, test } from "bun:test";
import { mapEnvelope } from "../src/adapters/signal/map-envelope";
import { conversationTarget, peerId, peerName } from "../src/adapters/signal/map-target";
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

	test("leaves the name blank for an unnamed group, so a known name survives", () => {
		const unnamed = withData({ timestamp: 1, message: "hi", groupInfo: { groupId: "group-2" } });
		expect(conversationTarget(unnamed)).toEqual({ id: "group-2", name: "", kind: "group" });
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
			authorId: "b5b0c3d2-0000-4000-8000-000000000000",
			body: "pushed the fix",
			sentAt: 1_760_000_000_000,
			isOutgoing: false,
			isDeleted: false,
			attachments: [],
		});
		expect(mapped.conversation).toEqual({
			id: "b5b0c3d2-0000-4000-8000-000000000000",
			name: "Alice",
			// the store owns the count; mapping never guesses a total
			unreadCount: 0,
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

	test("an envelope with neither text nor files is not a message", () => {
		// Stickers, polls, pins and group-call updates arrive as data messages with no
		// content of their own. Writing one leaves a blank row, a bumped conversation and
		// a notification with no words in it, so the mapper builds no message at all.
		const mapped = mapEnvelope(withData({ timestamp: 1, sticker: { packId: "x", stickerId: 1 } }));

		expect(mapped.message).toBeNull();
		expect(mapped.conversation).toBeNull();
	});

	test("stamps a disappearing message with the moment it is due", () => {
		const mapped = mapEnvelope(
			withData({ timestamp: 1_000, message: "gone soon", expiresInSeconds: 86_400 }),
		);

		expect(mapped.message?.expiresAt).toBe(1_000 + 86_400_000);
	});

	test("the conversation learns the timer its messages carry", () => {
		const mapped = mapEnvelope(
			withData({ timestamp: 1_000, message: "hi", expiresInSeconds: 3_600 }),
		);

		// Our own outgoing messages have no timer of their own — Signal never echoes
		// them — so the conversation is where the number comes from.
		expect(mapped.conversation?.expiresInSeconds).toBe(3_600);
	});

	test("leaves the deadline off when the timer is absent or switched off", () => {
		expect(mapEnvelope(withData({ timestamp: 1_000, message: "kept" })).message?.expiresAt).toBe(
			undefined,
		);
		// signal-cli reports a cleared timer as zero, not as a missing field.
		expect(
			mapEnvelope(withData({ timestamp: 1_000, message: "kept", expiresInSeconds: 0 })).message
				?.expiresAt,
		).toBe(undefined);
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

	test("maps your own sent message from a sync transcript as outgoing", () => {
		const envelope: Envelope = {
			timestamp: 1,
			syncMessage: {
				sentMessage: {
					timestamp: 1_760_000_000_000,
					message: "on my way",
					destinationUuid: "uuid-bob",
					destinationNumber: "+10000000002",
				},
			},
		};

		const mapped = mapEnvelope(envelope);

		expect(mapped.message).toEqual({
			id: "uuid-bob:1760000000000",
			conversationId: "uuid-bob",
			author: "You",
			authorId: "self",
			body: "on my way",
			sentAt: 1_760_000_000_000,
			isOutgoing: true,
			isDeleted: false,
			attachments: [],
		});
		// No name: a transcript only knows the destination id.
		expect(mapped.conversation?.name).toBe("");
		expect(mapped.conversation?.unreadCount).toBe(0);
		expect(mapped.conversationKind).toBe("direct");
	});

	test("maps a sent message to a group by group id", () => {
		const envelope: Envelope = {
			timestamp: 1,
			syncMessage: {
				sentMessage: {
					timestamp: 5,
					message: "hi all",
					destinationNumber: "+10000000002",
					groupInfo: { groupId: "group-9", groupName: "Signal devs" },
				},
			},
		};

		const mapped = mapEnvelope(envelope);

		expect(mapped.conversation).toEqual({
			id: "group-9",
			name: "Signal devs",
			unreadCount: 0,
			lastActivityAt: 5,
		});
		expect(mapped.conversationKind).toBe("group");
	});

	test("does not rename a group from a transcript without a group name", () => {
		const envelope: Envelope = {
			timestamp: 1,
			syncMessage: {
				sentMessage: { timestamp: 5, message: "hi all", groupInfo: { groupId: "group-9" } },
			},
		};

		expect(mapEnvelope(envelope).conversation?.name).toBe("");
	});

	test("ignores a sync transcript without a destination", () => {
		const envelope: Envelope = {
			timestamp: 1,
			syncMessage: { sentMessage: { timestamp: 1, message: "nowhere" } },
		};
		expect(mapEnvelope(envelope)).toEqual({
			message: null,
			conversation: null,
			conversationKind: "direct",
			deleted: null,
			edited: null,
			receipt: null,
			reaction: null,
			typing: null,
		});
	});

	test("returns nothing for an envelope carrying no payload at all", () => {
		// Not a typing envelope: that one carries state the session keeps (see
		// `map-envelope-typing.test.ts`), it just never becomes a message.
		const mapped = mapEnvelope({ timestamp: 1 });
		expect(mapped).toEqual({
			message: null,
			conversation: null,
			conversationKind: "direct",
			deleted: null,
			edited: null,
			receipt: null,
			reaction: null,
			typing: null,
		});
	});

	test("returns nothing when the sender cannot be identified", () => {
		const anonymous: Envelope = { timestamp: 1, dataMessage: { timestamp: 1, message: "hi" } };
		expect(mapEnvelope(anonymous)).toEqual({
			message: null,
			conversation: null,
			conversationKind: "direct",
			deleted: null,
			edited: null,
			receipt: null,
			reaction: null,
			typing: null,
		});
	});
});
