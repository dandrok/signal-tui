import { describe, expect, test } from "bun:test";
import { mapEnvelope } from "../src/adapters/signal/map-envelope";
import type { Envelope } from "../src/adapters/signal/schemas";

const envelope = (overrides: Partial<Envelope> = {}): Envelope => ({
	source: "+100****0000",
	sourceNumber: "+100****0000",
	sourceUuid: "b5b0c3d2-0000-4000-8000-000000000000",
	sourceName: "Alice",
	sourceDevice: 1,
	timestamp: 1_759_999_999_000,
	...overrides,
});

const groupInfo = { groupId: "group-1", groupName: "Signal devs" };

/** An edit carries a copy of the data message; only its text may replace a body. */
describe("mapEnvelope edits", () => {
	test("maps an edit to the message it replaces", () => {
		const mapped = mapEnvelope(
			envelope({
				editMessage: {
					targetSentTimestamp: 500,
					dataMessage: { timestamp: 900, message: "typo fixed" },
				} as Envelope["editMessage"],
			}),
		);

		expect(mapped.edited).toEqual({
			conversationId: "b5b0c3d2-0000-4000-8000-000000000000",
			targetSentAt: 500,
			body: "typo fixed",
		});
		// An edit is not a new message: nothing may be inserted for it.
		expect(mapped.message).toBeNull();
		expect(mapped.conversation).toBeNull();
	});

	test("takes the group from the edit's own data message", () => {
		const mapped = mapEnvelope(
			envelope({
				editMessage: {
					targetSentTimestamp: 500,
					dataMessage: { timestamp: 900, message: "fixed", groupInfo },
				} as Envelope["editMessage"],
			}),
		);

		expect(mapped.edited?.conversationId).toBe("group-1");
		expect(mapped.conversationKind).toBe("group");
	});

	test("ignores an edit whose data message only carries files", () => {
		// `bodyOf` answers "[attachment]" for that shape; an edit must never paste a
		// placeholder over the text a peer wrote.
		const mapped = mapEnvelope(
			envelope({
				editMessage: {
					targetSentTimestamp: 500,
					dataMessage: {
						timestamp: 900,
						attachments: [
							{ id: "a1", contentType: "image/png", filename: "/tmp/x.png", isVoiceNote: false },
						],
					},
				} as Envelope["editMessage"],
			}),
		);

		expect(mapped.edited).toBeNull();
	});

	test("takes a file caption as the replacement text", () => {
		const mapped = mapEnvelope(
			envelope({
				editMessage: {
					targetSentTimestamp: 500,
					dataMessage: {
						timestamp: 900,
						attachments: [
							{
								id: "a1",
								contentType: "image/png",
								filename: "/tmp/x.png",
								caption: "the caption",
								isVoiceNote: false,
							},
						],
					},
				} as Envelope["editMessage"],
			}),
		);

		expect(mapped.edited?.body).toBe("the caption");
	});

	test("ignores an edit that carries no replacement text", () => {
		const mapped = mapEnvelope(
			envelope({
				editMessage: {
					targetSentTimestamp: 500,
					dataMessage: { timestamp: 900 },
				} as Envelope["editMessage"],
			}),
		);

		expect(mapped.edited).toBeNull();
	});
});
