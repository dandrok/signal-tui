import { describe, expect, test } from "bun:test";
import { mapEnvelope } from "../src/adapters/signal/map-envelope";
import type { Envelope } from "../src/adapters/signal/schemas";

/**
 * A data message is not always a message.
 *
 * Stickers, polls, pins, payments and group-call updates all arrive as `dataMessage`
 * objects with no text and no files. Mapping them as messages leaves a blank row in the
 * thread, bumps the conversation, counts an unread and announces a notification with no
 * words in it — the shape a user reports as "the client shows empty lines". One ringing
 * group call emits a group-call update every few seconds, so the noise compounds.
 *
 * Kinds are the ones `JsonDataMessage` declares at signal-cli v0.14.9, minus the ones
 * that carry content of their own (`reaction`, `remoteDelete`, `quote`, `attachments`)
 * and the timer change, which says something about the conversation rather than nothing —
 * it has its own tests below.
 */
const envelope = (dataMessage: Record<string, unknown>): Envelope => ({
	source: "+100****0000",
	sourceNumber: "+100****0000",
	sourceUuid: "b5b0c3d2-0000-4000-8000-000000000000",
	sourceName: "Alice",
	sourceDevice: 1,
	timestamp: 1_759_999_999_000,
	dataMessage: { timestamp: 1_759_999_999_000, ...dataMessage } as Envelope["dataMessage"],
});

const CONTENT_FREE: Readonly<Record<string, Record<string, unknown>>> = {
	sticker: { sticker: { packId: "pack", stickerId: 3 } },
	"poll create": { pollCreate: { question: "lunch?", options: [], allowMultiple: false } },
	"poll vote": { pollVote: { pollAuthor: "+100****0000", pollTimestamp: 1, optionIndexes: [0] } },
	"poll terminate": { pollTerminate: { pollTimestamp: 1 } },
	"group call update": { groupCallUpdate: { eraId: "era-1" } },
	pin: { pinMessage: { targetAuthor: "+100****0000", targetSentTimestamp: 1 } },
	unpin: { unpinMessage: { targetAuthor: "+100****0000", targetSentTimestamp: 1 } },
	payment: { payment: { receipt: "abc" } },
	"shared contact": { contacts: [{ name: { displayName: "Bob" } }] },
	"admin delete": { adminDelete: { targetSentTimestamp: 1 } },
	"end session": { isEndSession: true },
	"profile key update": { isProfileKeyUpdate: true, hasProfileKey: true },
};

describe("mapEnvelope events that are not messages", () => {
	for (const [kind, payload] of Object.entries(CONTENT_FREE)) {
		test(`${kind} builds no message and no conversation`, () => {
			const mapped = mapEnvelope(envelope(payload));

			expect(mapped.message).toBeNull();
			// Not a message means not a conversation either: a thread must not appear
			// because a stranger's group call rang once.
			expect(mapped.conversation).toBeNull();
		});
	}

	test("a message whose text is empty builds nothing", () => {
		// Signal refuses to send empty text, so an empty body means the payload's content
		// lived somewhere this client does not model.
		expect(mapEnvelope(envelope({ message: "" })).message).toBeNull();
	});

	test("a view-once message keeps its row, which is the whole point of it", () => {
		// The one payload whose content is empty on purpose: the row with its notice is
		// what records that something arrived and was deliberately not kept.
		const mapped = mapEnvelope(envelope({ viewOnce: true, attachments: [] }));

		expect(mapped.message?.body).toBe("");
		expect(mapped.message?.isViewOnce).toBe(true);
		expect(mapped.conversation?.id).toBe("b5b0c3d2-0000-4000-8000-000000000000");
	});

	test("the guard runs after the event branches, so a reaction still maps", () => {
		// A reaction rides inside a data message with no text of its own. Dropping it as
		// "content-free" would silently stop showing every emoji a peer adds.
		const mapped = mapEnvelope(
			envelope({
				reaction: {
					emoji: "👍",
					targetSentTimestamp: 1_759_999_999_000,
					targetAuthorUuid: "uuid-alice",
					isRemove: false,
				},
			}),
		);

		expect(mapped.reaction?.emoji).toBe("👍");
		expect(mapped.message).toBeNull();
	});

	test("a delete-for-everyone still maps and is still not a message", () => {
		const mapped = mapEnvelope(envelope({ remoteDelete: { timestamp: 1_759_999_999_000 } }));

		expect(mapped.deleted?.messageId).toBe("b5b0c3d2-0000-4000-8000-000000000000:1759999999000");
		expect(mapped.message).toBeNull();
	});

	test("our own sticker, echoed from another device, is dropped too", () => {
		// The transcript path needs the same rule: sending a sticker from the phone must
		// not paint a blank row on this device either.
		const mapped = mapEnvelope({
			timestamp: 1_759_999_999_100,
			syncMessage: {
				sentMessage: {
					timestamp: 1_759_999_999_000,
					destinationUuid: "uuid-bob",
					sticker: { packId: "pack", stickerId: 3 },
				},
			},
		} as Envelope);

		expect(mapped.message).toBeNull();
		expect(mapped.conversation).toBeNull();
	});
});

/**
 * A timer change is the one content-free payload that is not nothing.
 *
 * The peer switched the disappearing-messages timer on or off, and Signal announces it as
 * a data message whose entire payload is the number. The client keeps the timer on the
 * conversation because Signal never echoes our own sends back, so the number is what
 * stamps our own outgoing messages: dropping it means text sent after a timer was switched
 * on keeps no deadline, and text sent after one was switched off inherits one.
 */
describe("mapEnvelope timer changes", () => {
	test("carries the number onto the conversation without a message", () => {
		const mapped = mapEnvelope(envelope({ isExpirationUpdate: true, expiresInSeconds: 86_400 }));

		expect(mapped.message).toBeNull();
		expect(mapped.conversation?.expiresInSeconds).toBe(86_400);
		expect(mapped.conversation?.id).toBe("b5b0c3d2-0000-4000-8000-000000000000");
	});

	test("carries a switched-off timer as an explicit zero", () => {
		// `0` is how Signal says "timer off", and the store treats it as a value rather
		// than as "nothing known" — so it must reach the conversation, not be dropped.
		const mapped = mapEnvelope(envelope({ isExpirationUpdate: true, expiresInSeconds: 0 }));

		expect(mapped.message).toBeNull();
		expect(mapped.conversation?.expiresInSeconds).toBe(0);
	});

	test("an expiration update with no number changes nothing", () => {
		const mapped = mapEnvelope(envelope({ isExpirationUpdate: true }));

		expect(mapped.message).toBeNull();
		expect(mapped.conversation).toBeNull();
	});

	test("the number alone is not an update: a plain message keeps its own timer", () => {
		// `expiresInSeconds` rides on every message sent inside a timer, and those are
		// messages, not timer changes. The flag is what separates the two.
		const mapped = mapEnvelope(envelope({ message: "hi", expiresInSeconds: 3_600 }));

		expect(mapped.message?.body).toBe("hi");
		expect(mapped.conversation?.expiresInSeconds).toBe(3_600);
	});
});
