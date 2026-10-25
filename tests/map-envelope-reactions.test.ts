import { describe, expect, test } from "bun:test";
import { mapEnvelope } from "../src/adapters/signal/map-envelope";
import type { Envelope } from "../src/adapters/signal/schemas";

const envelope = (overrides: Partial<Envelope> = {}): Envelope => ({
	source: "+100****0000",
	sourceNumber: "+100****0000",
	sourceUuid: "b5b0c3d2-0000-4000-8000-000000000000",
	sourceName: "Alice",
	sourceDevice: 1,
	timestamp: 2,
	...overrides,
});

const reaction = (overrides: Record<string, unknown> = {}) => ({
	emoji: "👍",
	targetSentTimestamp: 1_759_999_999_000,
	isRemove: false,
	...overrides,
});

/**
 * A reaction arrives inside a data message but is an event about an existing message.
 * Mapping it as a message is the bug this suite exists for: every emoji would leave a
 * blank row in the thread and bump the conversation.
 */
describe("mapEnvelope reactions", () => {
	test("maps a reaction to an event, never to a message", () => {
		const mapped = mapEnvelope(
			envelope({ dataMessage: { timestamp: 2, reaction: reaction() } as never }),
		);

		expect(mapped.reaction).toEqual({
			conversationId: "b5b0c3d2-0000-4000-8000-000000000000",
			targetSentAt: 1_759_999_999_000,
			reactor: { id: "b5b0c3d2-0000-4000-8000-000000000000", label: "Alice" },
			emoji: "👍",
			isRemove: false,
		});
		expect(mapped.message).toBeNull();
		expect(mapped.conversation).toBeNull();
	});

	test("takes the group from the message the reaction arrived in", () => {
		const mapped = mapEnvelope(
			envelope({
				dataMessage: {
					timestamp: 2,
					groupInfo: { groupId: "group-1", groupName: "Signal devs" },
					reaction: reaction(),
				} as never,
			}),
		);

		expect(mapped.reaction?.conversationId).toBe("group-1");
		expect(mapped.conversationKind).toBe("group");
	});

	test("passes a removal through as a removal", () => {
		const mapped = mapEnvelope(
			envelope({ dataMessage: { timestamp: 2, reaction: reaction({ isRemove: true }) } as never }),
		);

		expect(mapped.reaction?.isRemove).toBe(true);
	});

	test("ignores a reaction with no emoji", () => {
		// Nothing to draw, and guessing would put a marker on a message nobody reacted to.
		const mapped = mapEnvelope(
			envelope({ dataMessage: { timestamp: 2, reaction: reaction({ emoji: "  " }) } as never }),
		);

		expect(mapped.reaction).toBeNull();
		expect(mapped.message).toBeNull();
	});

	test("maps our own reaction from a sync transcript as ours", () => {
		const mapped = mapEnvelope(
			envelope({
				timestamp: 3,
				syncMessage: {
					sentMessage: {
						timestamp: 3,
						destinationUuid: "uuid-bob",
						reaction: reaction(),
					} as never,
				},
			}),
		);

		expect(mapped.reaction?.conversationId).toBe("uuid-bob");
		expect(mapped.reaction?.reactor).toEqual({ id: "self", label: "You" });
		// The transcript must not become a message of its own either.
		expect(mapped.message).toBeNull();
	});
});
