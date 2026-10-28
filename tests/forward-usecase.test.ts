import { describe, expect, test } from "bun:test";
import {
	canForward,
	forwardMatches,
	forwardNotice,
	forwardPlan,
	forwardRefusal,
	forwardTarget,
	forwardTargets,
} from "../src/app/usecases/forward";
import type { Attachment, Conversation, Message } from "../src/domain/types";

/**
 * Forwarding is an ordinary send to a second conversation, so what is tested here is what the
 * key is allowed to do and where it aims — not the transport, which is the same `send` a draft
 * uses.
 */

const AMBER = "uuid-amber";
const BORIS = "+48123456789";
const CAROL = "group-carol";

const conversation = (id: string, name: string, lastActivityAt = 1_000): Conversation => ({
	id,
	name,
	unreadCount: 0,
	lastActivityAt,
});

const message = (over: Partial<Message> = {}): Message => ({
	id: `${AMBER}:1000`,
	conversationId: AMBER,
	author: "Amber",
	authorId: AMBER,
	body: "dinner at 7?",
	sentAt: 1_000,
	isOutgoing: false,
	isDeleted: false,
	attachments: [],
	...over,
});

const attachment: Attachment = {
	id: "file-1",
	contentType: "image/jpeg",
	filename: "/tmp/photo.jpg",
	size: 2_048,
	caption: "look",
	isVoiceNote: false,
};

const targets = forwardTargets(
	[
		conversation(AMBER, "Amber", 3_000),
		conversation(BORIS, "Boris", 2_000),
		conversation(CAROL, "Carol and co", 1_000),
	],
	AMBER,
);

describe("what can be forwarded", () => {
	test("text is forwardable, and the plan is the same words addressed elsewhere", () => {
		expect(forwardRefusal(message(), AMBER)).toBeNull();
		expect(canForward(message(), AMBER)).toBe(true);
		expect(forwardPlan(message(), AMBER, targets, "boris", 0)).toEqual({
			kind: "send",
			to: conversation(BORIS, "Boris", 2_000),
			body: "dinner at 7?",
		});
	});

	test("a message with files is refused rather than sent as its caption alone", () => {
		// Half a message arriving as a whole one is worse than a refusal: the reader cannot
		// tell the photo was never sent.
		const withFile = message({ body: "look", attachments: [attachment] });

		expect(canForward(withFile, AMBER)).toBe(false);
		expect(forwardRefusal(withFile, AMBER)).toContain("text only");
		expect(forwardPlan(withFile, AMBER, targets, "", 0)).toEqual({
			kind: "refused",
			reason: expect.stringContaining("text only"),
		});
	});

	test("a filter that matches nobody refuses, and names the filter rather than the message", () => {
		// The two refusals are different sentences because they call for different next moves:
		// one means "this message cannot travel", the other means "fix what you typed".
		expect(forwardPlan(message(), AMBER, targets, "zzz", 0)).toEqual({
			kind: "refused",
			reason: "no conversation matches that",
		});
		expect(forwardPlan(undefined, AMBER, targets, "", 0)).toEqual({
			kind: "refused",
			reason: "that message is gone: nothing to forward",
		});
	});

	test("deleted, expired and view-once rows have no words to copy", () => {
		for (const over of [{ isDeleted: true }, { isExpired: true }, { isViewOnce: true }]) {
			const row = message(over);
			expect(canForward(row, AMBER)).toBe(false);
			expect(forwardRefusal(row, AMBER)).toContain("nothing to forward");
		}
		// An attachment-only row with no caption has a body of "" — the same refusal, not an
		// empty message sent to somebody.
		expect(forwardRefusal(message({ body: "" }), AMBER)).toContain("no text");
	});

	test("a message from another conversation is not forwardable here", () => {
		expect(forwardRefusal(message({ conversationId: BORIS }), AMBER)).toContain("not in this");
	});
});

describe("where a forward can go", () => {
	test("the thread it came from is not a destination", () => {
		expect(targets.map((entry) => entry.id)).toEqual([BORIS, CAROL]);
	});

	test("typing filters by name, case-insensitively", () => {
		expect(forwardMatches(targets, "bor", 0).matches.map((entry) => entry.name)).toEqual(["Boris"]);
		expect(forwardMatches(targets, "CAROL", 0).matches.map((entry) => entry.name)).toEqual([
			"Carol and co",
		]);
		// An empty draft is every conversation, in the list's own order.
		expect(forwardMatches(targets, "", 0).matches).toHaveLength(2);
	});

	test("the highlight is clamped, not wrapped, when a filter shrinks under it", () => {
		expect(forwardMatches(targets, "", 9).picked).toBe(1);
		// Nothing matched: there is no position to keep, and no conversation to send to.
		expect(forwardMatches(targets, "zzz", 3)).toEqual({ matches: [], picked: 0 });
		expect(forwardTarget(targets, "zzz", 3)).toBeUndefined();
	});

	test("the highlighted match is the one a confirm sends to", () => {
		expect(forwardTarget(targets, "", 0)?.id).toBe(BORIS);
		expect(forwardTarget(targets, "", 1)?.id).toBe(CAROL);
		expect(forwardNotice(conversation(BORIS, "Boris"))).toBe("forwarded to Boris");
	});
});
