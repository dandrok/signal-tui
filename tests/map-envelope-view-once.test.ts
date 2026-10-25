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

const photo = {
	id: "a1",
	contentType: "image/jpeg",
	isVoiceNote: false,
	filename: "/home/you/.local/share/signal-cli/attachments/holiday.jpg",
	size: 812_000,
	caption: "holiday snap",
};

/**
 * A view-once message is the sender asking that it not be kept. The mapper is the one
 * point every payload passes through, so the content has to be gone by the time it
 * leaves here — the store would otherwise be recording text the sender tamed.
 */
describe("mapEnvelope view-once", () => {
	test("drops the text and the file references of a view-once message", () => {
		const mapped = mapEnvelope(
			envelope({
				dataMessage: { timestamp: 1_759_999_999_000, viewOnce: true, attachments: [photo] },
			}),
		);

		expect(mapped.message?.body).toBe("");
		expect(mapped.message?.attachments).toEqual([]);
		expect(mapped.message?.isViewOnce).toBe(true);
		// The row itself still exists, so the thread keeps its shape.
		expect(mapped.message?.id).toBe("b5b0c3d2-0000-4000-8000-000000000000:1759999999000");
	});

	test("drops the caption too, which is where a photo's words live", () => {
		// `bodyOf` would answer the caption, so removing only `dataMessage.message`
		// would keep the sender's words in the body column — and in the search index.
		const mapped = mapEnvelope(
			envelope({
				dataMessage: {
					timestamp: 1,
					viewOnce: true,
					message: "look at this",
					attachments: [{ ...photo, caption: "caption text" }],
				},
			}),
		);

		expect(mapped.message?.body).toBe("");
	});

	test("keeps the content when the flag is absent", () => {
		const mapped = mapEnvelope(envelope({ dataMessage: { timestamp: 1, attachments: [photo] } }));

		expect(mapped.message?.body).toBe("holiday snap");
		expect(mapped.message?.attachments).toHaveLength(1);
		expect(mapped.message?.isViewOnce).toBeUndefined();
	});

	test("treats an explicit false as an ordinary message", () => {
		const mapped = mapEnvelope(
			envelope({ dataMessage: { timestamp: 1, message: "hello", viewOnce: false } }),
		);

		expect(mapped.message?.body).toBe("hello");
		expect(mapped.message?.isViewOnce).toBeUndefined();
	});

	test("applies the same rule to our own message echoed from another device", () => {
		const mapped = mapEnvelope(
			envelope({
				timestamp: 2,
				syncMessage: {
					sentMessage: {
						timestamp: 2,
						viewOnce: true,
						attachments: [photo],
						destinationUuid: "uuid-bob",
					},
				},
			}),
		);

		expect(mapped.message?.body).toBe("");
		expect(mapped.message?.attachments).toEqual([]);
		expect(mapped.message?.isViewOnce).toBe(true);
	});
});
