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

const reply = (quote: Record<string, unknown>): Envelope =>
	envelope({
		dataMessage: { timestamp: 900, message: "agreed", quote } as Envelope["dataMessage"],
	});

/**
 * A reply names the message it answers; it does not get to store that message's words
 * again. Signal's payload repeats them (`JsonQuote.text`), and the mapper's job is to drop
 * that copy: the cache keeps the identity, and the pane reads the text from the message
 * itself.
 */
describe("mapEnvelope quotes", () => {
	test("keeps the identity of the quoted message and none of its text", () => {
		const mapped = mapEnvelope(
			reply({
				id: 500,
				authorUuid: "uuid-marta",
				authorNumber: "+100****0001",
				text: "the original words",
			}),
		);

		expect(mapped.message?.quote).toEqual({ sentAt: 500, authorId: "uuid-marta" });
		// The copy is what would leak: it must not reach the message at all, not even in a
		// field nobody renders yet.
		expect(JSON.stringify(mapped.message)).not.toContain("the original words");
	});

	test("prefers the uuid and falls back to the number", () => {
		const withNumber = mapEnvelope(reply({ id: 500, authorNumber: "+100****0001", text: "x" }));
		expect(withNumber.message?.quote?.authorId).toBe("+100****0001");

		const withNeither = mapEnvelope(reply({ id: 500, text: "x" }));
		expect(withNeither.message?.quote).toEqual({ sentAt: 500, authorId: null });
	});

	test("two envelopes at the same instant are one message, not two", () => {
		// This is what lets the pane key its quote lookup on the timestamp alone: the id is
		// `<conversation>:<sentAt>` and it is the primary key, so a second row for the same
		// instant in one thread cannot exist — it merges into the first. A producer that
		// invented its own id would break this, and the lookup would then have two candidates
		// for one quote.
		const first = mapEnvelope(
			reply({ id: 500, authorUuid: "uuid-marta", text: "the original words" }),
		);
		const again = mapEnvelope(
			envelope({
				dataMessage: { timestamp: 900, message: "agreed" } as Envelope["dataMessage"],
			}),
		);

		expect(again.message?.id).toBe(first.message?.id);
		expect(first.message?.id).toBe("b5b0c3d2-0000-4000-8000-000000000000:900");
	});

	test("a message that is not a reply has no quote", () => {
		const mapped = mapEnvelope(
			envelope({
				dataMessage: { timestamp: 900, message: "just talking" } as Envelope["dataMessage"],
			}),
		);

		expect(mapped.message?.quote).toBeUndefined();
	});

	test("our own reply, echoed as a sync transcript, carries the quote too", () => {
		// `JsonSyncDataMessage` unwraps the data message, so `quote` arrives at the same
		// level as the destination fields — the same mapping has to read it.
		const mapped = mapEnvelope(
			envelope({
				syncMessage: {
					sentMessage: {
						timestamp: 900,
						message: "agreed",
						destinationUuid: "uuid-marta",
						quote: { id: 500, authorUuid: "uuid-marta", text: "the original words" },
					},
				} as Envelope["syncMessage"],
			}),
		);

		expect(mapped.message?.isOutgoing).toBe(true);
		expect(mapped.message?.quote).toEqual({ sentAt: 500, authorId: "uuid-marta" });
	});
});
