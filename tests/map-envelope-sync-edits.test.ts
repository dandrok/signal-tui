import { describe, expect, test } from "bun:test";
import { mapEnvelope } from "../src/adapters/signal/map-envelope";
import type { Envelope } from "../src/adapters/signal/schemas";
import { receiveEnvelopeSchema } from "../src/adapters/signal/schemas";

/**
 * An edit you make on another device.
 *
 * `JsonSyncDataMessage` is `(destination…, JsonEditMessage editMessage, @JsonUnwrapped
 * JsonDataMessage)`, and for a correction the flattened data message is **absent**: the
 * payload holds `editMessage` and nothing else. Two things followed from mapping it as a
 * message: the schema required a `timestamp` the payload does not have, so the whole
 * envelope was rejected as invalid, and — once it parsed — the mapper built a row with
 * `sentAt: undefined`, which the cache refuses with
 * `NOT NULL constraint failed: messages.sent_at`.
 */
const transcript = (sentMessage: Record<string, unknown>): Envelope =>
	({
		timestamp: 1_759_999_999_500,
		syncMessage: { sentMessage },
	}) as Envelope;

const corrected = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
	destinationUuid: "uuid-bob",
	destinationNumber: "+100****0009",
	editMessage: {
		targetSentTimestamp: 1_759_999_999_000,
		dataMessage: { timestamp: 1_759_999_999_000, message: "typo fixed" },
	},
	...overrides,
});

describe("mapEnvelope edits echoed from another device", () => {
	test("maps the correction onto the message it replaces", () => {
		const mapped = mapEnvelope(transcript(corrected()));

		expect(mapped.edited).toEqual({
			conversationId: "uuid-bob",
			targetSentAt: 1_759_999_999_000,
			// Our own rows carry this marker, so the store matches the row the edit
			// corrects instead of trusting a display name.
			editor: { id: "self", label: "You" },
			body: "typo fixed",
		});
		// An edit is never a message: nothing may be inserted for it.
		expect(mapped.message).toBeNull();
		expect(mapped.conversation).toBeNull();
	});

	test("takes the group from the edit's own data message", () => {
		const mapped = mapEnvelope(
			transcript(
				corrected({
					editMessage: {
						targetSentTimestamp: 1_759_999_999_000,
						dataMessage: {
							timestamp: 1_759_999_999_000,
							message: "typo fixed",
							groupInfo: { groupId: "group-1", groupName: "Signal devs" },
						},
					},
				}),
			),
		);

		expect(mapped.edited?.conversationId).toBe("group-1");
		expect(mapped.conversationKind).toBe("group");
	});

	test("a group edit with no destination still lands", () => {
		// A group send names no recipient, and an edit's flattened data message is absent,
		// so the inner group id is the only thing in the payload saying where the
		// correction belongs. Resolving the destination first would drop this edit.
		const mapped = mapEnvelope(
			transcript({
				editMessage: {
					targetSentTimestamp: 1_759_999_999_000,
					dataMessage: {
						timestamp: 1_759_999_999_000,
						message: "typo fixed",
						groupInfo: { groupId: "group-1", groupName: "Signal devs" },
					},
				},
			}),
		);

		expect(mapped.edited?.conversationId).toBe("group-1");
		expect(mapped.edited?.body).toBe("typo fixed");
		expect(mapped.conversationKind).toBe("group");
		expect(mapped.message).toBeNull();
	});

	test("an edit that names neither a group nor a destination is dropped", () => {
		const mapped = mapEnvelope(
			transcript({
				editMessage: {
					targetSentTimestamp: 1_759_999_999_000,
					dataMessage: { timestamp: 1_759_999_999_000, message: "typo fixed" },
				},
			}),
		);

		expect(mapped.edited).toBeNull();
		expect(mapped.message).toBeNull();
	});

	test("ignores a correction that carries no text", () => {
		// `bodyOf` would answer "[attachment]" for a file-only data message; an edit must
		// never paste that placeholder over what was written.
		const mapped = mapEnvelope(
			transcript(
				corrected({
					editMessage: {
						targetSentTimestamp: 1_759_999_999_000,
						dataMessage: {
							timestamp: 1_759_999_999_000,
							attachments: [{ contentType: "image/jpeg", isVoiceNote: false }],
						},
					},
				}),
			),
		);

		expect(mapped.edited).toBeNull();
	});

	test("a transcript with neither a timestamp nor an edit builds no message", () => {
		// This is the shape that used to produce `sentAt: undefined` and a cache error:
		// a payload with no identity cannot name a row, so nothing is built for it.
		const mapped = mapEnvelope(transcript({ destinationUuid: "uuid-bob" }));

		expect(mapped.message).toBeNull();
		expect(mapped.conversation).toBeNull();
	});

	test("a transcript with text but no timestamp is dropped rather than half-built", () => {
		// The other side of the same guard: the payload has words but no identity, so a
		// row for it would have to invent an id. Nothing is what it gets.
		const mapped = mapEnvelope(transcript({ destinationUuid: "uuid-bob", message: "no identity" }));

		expect(mapped.message).toBeNull();
		expect(mapped.conversation).toBeNull();
	});

	test("the real JSON shape reaches the mapper through the schema", () => {
		// The envelope is parsed the way `signal-cli` notifications are, so a schema that
		// demands a field this payload lacks fails here rather than in production.
		const parsed = receiveEnvelopeSchema.safeParse({
			account: "+100****0000",
			envelope: {
				timestamp: 1_759_999_999_500,
				syncMessage: { sentMessage: corrected() },
			},
		});

		expect(parsed.success).toBe(true);
		expect(parsed.success && mapEnvelope(parsed.data.envelope).edited?.body).toBe("typo fixed");
	});

	test("an ordinary sent transcript is still a message", () => {
		// The control for the guard above: a transcript with a timestamp and text is the
		// normal sync echo, and it must keep landing in the cache.
		const mapped = mapEnvelope(
			transcript({
				destinationUuid: "uuid-bob",
				timestamp: 1_759_999_999_000,
				message: "sent from my phone",
			}),
		);

		expect(mapped.message?.id).toBe("uuid-bob:1759999999000");
		expect(mapped.message?.isOutgoing).toBe(true);
		expect(mapped.edited).toBeNull();
	});
});
