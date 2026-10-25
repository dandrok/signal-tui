import { describe, expect, test } from "bun:test";
import { headerLine, headerSuffix } from "../src/domain/format";
import { reactionMarker, reactionsOf } from "../src/domain/reactions";
import type { Message, Reaction } from "../src/domain/types";

const reaction = (overrides: Partial<Reaction> = {}): Reaction => ({
	emoji: "👍",
	author: "Marta",
	authorId: "uuid-marta",
	...overrides,
});

const message = (reactions: readonly Reaction[] = []): Message => ({
	id: "m1",
	conversationId: "c1",
	author: "You",
	body: "hi",
	sentAt: 0,
	isOutgoing: true,
	isDeleted: false,
	...(reactions.length === 0 ? {} : { reactions }),
});

const clock = (): string => "10:00";

describe("reaction markers", () => {
	test("no reactions means no marker", () => {
		expect(reactionMarker(message())).toBe("");
		expect(reactionsOf(message())).toEqual([]);
	});

	test("counts the same emoji once and keeps the header short", () => {
		expect(
			reactionMarker(message([reaction(), reaction({ authorId: "uuid-bob", author: "Bob" })])),
		).toBe(" 👍 2");
	});

	test("ranks by count, then by emoji so both stores draw the same row", () => {
		const markers = reactionMarker(
			message([
				reaction({ emoji: "❤️" }),
				reaction({ emoji: "🎉", authorId: "uuid-bob" }),
				reaction({ emoji: "👍", authorId: "uuid-carl" }),
				reaction({ emoji: "👍", authorId: "uuid-dora" }),
			]),
		);

		expect(markers).toBe(" 👍 2 ❤️ 🎉");
	});

	test("stops at six distinct emojis and says so", () => {
		const many = ["😀", "❤️", "🎉", "😢", "🔥", "👀", "🙈"].map((emoji, index) =>
			reaction({ emoji, authorId: `uuid-${index}` }),
		);

		const markers = reactionMarker(message(many));

		expect(markers.endsWith("…")).toBe(true);
		expect(markers).not.toContain("🙈");
	});

	test("a reaction is remote text: control characters and newlines are stripped", () => {
		// A peer controls the emoji field; a line break or an escape sequence there would
		// land in the header, which is measured as one row.
		const hostile = reaction({ emoji: "\u001b[31m👍\nsecond line" });

		const markers = reactionMarker(message([hostile]));

		expect(markers).not.toContain("\u001b");
		expect(markers).not.toContain("\n");
		expect(markers).toContain("👍");
	});

	test("a paragraph-long payload cannot become the header", () => {
		const markers = reactionMarker(message([reaction({ emoji: "x".repeat(200) })]));
		expect(markers.length).toBeLessThan(30);
	});

	test("the header row carries the markers after the ticks", () => {
		const withReaction = message([reaction()]);
		expect(headerSuffix(withReaction)).toContain("👍");
		expect(headerLine({ ...withReaction, receipt: "read" }, clock)).toBe("10:00 You ✓✓ 👍");
	});
});
