import { describe, expect, test } from "bun:test";
import { mapEnvelope } from "../src/adapters/signal/map-envelope";
import type { Envelope } from "../src/adapters/signal/schemas";
import { eventsFrom } from "../src/adapters/signal/signal-cli-backend/events";

/**
 * A typing notice is state, not content: it must reach the session and must never become a
 * message, a conversation or a stored row. What is pinned here is the address (a group is keyed
 * by its group id, a direct chat by the sender) and the two actions that mean something.
 */

const GROUP_ID = "dGhpcyBpcyBhIGdyb3VwIGlkPQ==";

const envelope = (over: Partial<Envelope> = {}): Envelope => ({
	timestamp: 1_760_000_000_000,
	source: "+48111222333",
	sourceName: "Mum",
	sourceUuid: "uuid-mum",
	...over,
});

describe("mapEnvelope typing", () => {
	test("a peer who started writing names their conversation and says who they are", () => {
		const mapped = mapEnvelope(envelope({ typingMessage: { action: "STARTED", timestamp: 1 } }));

		expect(mapped.typing).toEqual({
			conversationId: "uuid-mum",
			conversationKind: "direct",
			author: "Mum",
			isTyping: true,
		});
		// Nothing to store: no message, no conversation update.
		expect(mapped.message).toBeNull();
		expect(mapped.conversation).toBeNull();
	});

	test("the event it becomes carries the same three facts and nothing else", () => {
		const events = eventsFrom(
			mapEnvelope(envelope({ typingMessage: { action: "STARTED", timestamp: 1 } })),
		);

		expect(events).toEqual([
			{ kind: "typing", conversationId: "uuid-mum", author: "Mum", isTyping: true },
		]);
	});

	test("in a group the group id wins, because that is the conversation it belongs to", () => {
		const mapped = mapEnvelope(
			envelope({ typingMessage: { action: "STARTED", timestamp: 1, groupId: GROUP_ID } }),
		);

		expect(mapped.typing?.conversationId).toBe(GROUP_ID);
		// The group is registered from it too: a typing notice can be the first thing this
		// session sees from a group, and a later send needs the id.
		expect(mapped.conversationKind).toBe("group");
	});

	test("STOPPED is the same notice with the opposite meaning", () => {
		const mapped = mapEnvelope(envelope({ typingMessage: { action: "STOPPED", timestamp: 2 } }));

		expect(mapped.typing?.isTyping).toBe(false);
	});

	test("an action this build does not know is ignored, not read as writing", () => {
		// The two actions are opposites; guessing at a third would leave a client showing a
		// stranger typing for as long as the app runs.
		const mapped = mapEnvelope(envelope({ typingMessage: { action: "PAUSED", timestamp: 1 } }));

		expect(mapped.typing).toBeNull();
	});

	test("a notice that names nobody is dropped", () => {
		const anonymous: Envelope = {
			timestamp: 1,
			typingMessage: { action: "STARTED", timestamp: 1 },
		};

		expect(mapEnvelope(anonymous).typing).toBeNull();
	});
});
