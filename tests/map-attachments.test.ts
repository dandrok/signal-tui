import { describe, expect, test } from "bun:test";
import { mapAttachments } from "../src/adapters/signal/map-attachments";
import { mapEnvelope } from "../src/adapters/signal/map-envelope";
import type { Envelope } from "../src/adapters/signal/schemas";

const envelope = (overrides: Partial<Envelope> = {}): Envelope =>
	({
		sourceUuid: "uuid-alice",
		sourceName: "Alice",
		...overrides,
	}) as Envelope;

const withData = (data: Record<string, unknown>): Envelope =>
	envelope({ dataMessage: { timestamp: 1_760_000_000_000, ...data } as never });

describe("mapAttachments", () => {
	test("keeps every field signal-cli reports", () => {
		const mapped = mapAttachments([
			{
				id: "a1",
				contentType: "image/png",
				filename: "/var/attachments/photo.png",
				size: 2048,
				caption: "look",
				isVoiceNote: false,
			},
		]);

		expect(mapped).toEqual([
			{
				id: "a1",
				contentType: "image/png",
				filename: "/var/attachments/photo.png",
				size: 2048,
				caption: "look",
				isVoiceNote: false,
			},
		]);
	});

	test("narrows missing and wrong-typed fields instead of failing", () => {
		const [mapped] = mapAttachments([{ id: 7, size: "big", filename: null, isVoiceNote: "yes" }]);

		expect(mapped).toEqual({
			id: null,
			contentType: null,
			filename: null,
			size: null,
			caption: null,
			isVoiceNote: false,
		});
	});

	test("drops null entries, which older releases emit", () => {
		expect(mapAttachments([null, undefined, "nope", { id: "a1" }])).toEqual([
			{
				id: "a1",
				contentType: null,
				filename: null,
				size: null,
				caption: null,
				isVoiceNote: false,
			},
		]);
	});

	test("is empty for a message without files", () => {
		expect(mapAttachments(undefined)).toEqual([]);
		expect(mapAttachments([])).toEqual([]);
	});
});

describe("attachments on a mapped message", () => {
	test("puts incoming files on the message", () => {
		const mapped = mapEnvelope(
			withData({
				attachments: [{ id: "a1", contentType: "image/png", size: 10, isVoiceNote: false }],
			}),
		);

		expect(mapped.message?.attachments).toHaveLength(1);
		expect(mapped.message?.body).toBe("[attachment]");
	});

	test("uses the attachment caption as the body when the message has no text", () => {
		const mapped = mapEnvelope(
			withData({
				attachments: [{ id: "a1", contentType: "image/png", caption: "the 4 MiB limit", size: 10 }],
			}),
		);

		// Captions live on the attachment, so without this the text would vanish.
		expect(mapped.message?.body).toBe("the 4 MiB limit");
	});

	test("prefers the message text over a caption", () => {
		const mapped = mapEnvelope(
			withData({ message: "look at this", attachments: [{ id: "a1", caption: "ignored" }] }),
		);

		expect(mapped.message?.body).toBe("look at this");
	});

	test("puts files from a sync transcript on your own message", () => {
		const mapped = mapEnvelope(
			envelope({
				syncMessage: {
					sentMessage: {
						destinationUuid: "uuid-alice",
						timestamp: 1_760_000_000_000,
						message: "here you go",
						attachments: [{ id: "a2", filename: "/tmp/report.pdf", size: 1024 }],
					},
				},
			} as never),
		);

		expect(mapped.message?.isOutgoing).toBe(true);
		expect(mapped.message?.attachments).toEqual([
			{
				id: "a2",
				contentType: null,
				filename: "/tmp/report.pdf",
				size: 1024,
				caption: null,
				isVoiceNote: false,
			},
		]);
	});
});
