import { describe, expect, test } from "bun:test";
import { canReactTo, reactionFor, targetedMessage } from "../src/app/usecases/react";
import { reactionEmojiOf } from "../src/domain/reactions";
import type { Message } from "../src/domain/types";
import { SELF_AUTHOR_ID } from "../src/domain/types";
import { DIRECT_ID, GROUP_ID } from "./helpers/session-fakes";

/**
 * Reacting, as a rule rather than a screen.
 *
 * The interesting cases are the ones the wire refuses: an author the engine cannot resolve,
 * a row that is gone, and an "emoji" that is a paragraph.
 */

const incoming = (overrides: Partial<Message> = {}): Message => ({
	id: "m1",
	conversationId: DIRECT_ID,
	author: "Alice",
	authorId: "uuid-alice",
	body: "hi",
	sentAt: 1_000,
	isOutgoing: false,
	isDeleted: false,
	...overrides,
});

/** A row cached before schema v4: no author id at all, which is not the same as `undefined`. */
const noAuthor = (overrides: Partial<Message> = {}): Message => {
	const { authorId: _dropped, ...rest } = incoming(overrides);
	return rest;
};

describe("canReactTo", () => {
	test("a live message from a known author can be reacted to", () => {
		expect(canReactTo(incoming(), DIRECT_ID)).toBe(true);
	});

	test("a deleted or expired row cannot", () => {
		// Both keep the row and blank its text; the store refuses reactions on either, so the
		// key has to refuse them too or the prompt opens on something that cannot be sent.
		expect(canReactTo(incoming({ isDeleted: true }), DIRECT_ID)).toBe(false);
		expect(canReactTo(incoming({ isExpired: true }), DIRECT_ID)).toBe(false);
	});

	test("a view-once row can: the row is there, and its words were never kept", () => {
		expect(canReactTo(incoming({ isViewOnce: true }), DIRECT_ID)).toBe(true);
	});

	test("a group row whose author was never cached cannot", () => {
		// A display name is not an identifier the engine can resolve.
		expect(canReactTo(noAuthor(), GROUP_ID)).toBe(false);
	});

	test("a direct row whose author was never cached uses the conversation id", () => {
		// Rows cached before schema v4 stored author ids; in a direct chat the conversation
		// *is* the peer, so the reaction can still be addressed.
		expect(canReactTo(noAuthor(), DIRECT_ID)).toBe(true);
	});
});

describe("reactionFor", () => {
	test("names the message by its timestamp and author", () => {
		expect(reactionFor(incoming(), DIRECT_ID, "👍")).toEqual({
			target: { sentAt: 1_000, authorId: "uuid-alice" },
			emoji: "👍",
			isRemove: false,
		});
	});

	test("our own message is addressed by the self marker, which the adapter resolves", () => {
		const mine = noAuthor({ isOutgoing: true, author: "You" });

		expect(reactionFor(mine, DIRECT_ID, "👍")?.target.authorId).toBe(SELF_AUTHOR_ID);
	});

	test("refuses a row that is gone, an unknown target, and an empty prompt", () => {
		expect(reactionFor(incoming({ isDeleted: true }), DIRECT_ID, "👍")).toBeNull();
		expect(reactionFor(undefined, DIRECT_ID, "👍")).toBeNull();
		expect(reactionFor(incoming(), DIRECT_ID, "   ")).toBeNull();
	});

	test("refuses two emoji, and says so by sending nothing", () => {
		expect(reactionFor(incoming(), DIRECT_ID, "👍❤️")).toBeNull();
	});

	test("takes a multi-part emoji whole", () => {
		// A family emoji is eleven UTF-16 units and one grapheme; a code-unit cut would send
		// a different symbol.
		expect(reactionFor(incoming(), DIRECT_ID, "👨‍👩‍👧‍👦")?.emoji).toBe("👨‍👩‍👧‍👦");
	});
});

describe("reactionEmojiOf", () => {
	test("strips what a terminal must not receive", () => {
		expect(reactionEmojiOf("👍\u001b[31m")).toBe("👍");
	});

	test("an empty prompt is nothing, not an empty emoji", () => {
		expect(reactionEmojiOf("")).toBeNull();
		expect(reactionEmojiOf("   ")).toBeNull();
	});
});

describe("targetedMessage", () => {
	test("finds the row a prompt names, and nothing when it is gone", () => {
		const thread = [incoming(), incoming({ id: "m2", sentAt: 2_000 })];

		expect(targetedMessage(thread, "m2")?.sentAt).toBe(2_000);
		expect(targetedMessage(thread, "m9")).toBeUndefined();
		expect(targetedMessage(thread, null)).toBeUndefined();
	});

	test("the same emoji again is a removal, not a second reaction", () => {
		// Signal clients behave this way, and the wire already takes `remove`: typing the emoji
		// you already added is how a reaction is taken back.
		const reacted = incoming({
			reactions: [{ emoji: "👍", author: "You", authorId: SELF_AUTHOR_ID }],
		});

		expect(reactionFor(reacted, DIRECT_ID, "👍")?.isRemove).toBe(true);
		expect(reactionFor(reacted, DIRECT_ID, "🎉")?.isRemove).toBe(false);
	});

	test("someone else's reaction is not ours to replace", () => {
		const reacted = incoming({
			reactions: [{ emoji: "👍", author: "Alice", authorId: "uuid-alice" }],
		});

		expect(reactionFor(reacted, DIRECT_ID, "👍")?.isRemove).toBe(false);
	});
});
