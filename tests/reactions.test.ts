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

	test("a multi-part emoji is never cut in the middle", () => {
		// Eleven UTF-16 units, one symbol. A code-unit cut answers "👨‍👩‍👧" — a different emoji —
		// and the old cap of eight did exactly that.
		const family = "👨‍👩‍👧‍👦";
		expect(reactionMarker(message([reaction({ emoji: family })]))).toBe(` ${family}`);
	});

	test("two long emoji that share a prefix stay distinct", () => {
		const family = "👨‍👩‍👧‍👦";
		const couple = "👨‍👩‍👧‍👧";
		const markers = reactionMarker(
			message([reaction({ emoji: family }), reaction({ emoji: couple, authorId: "uuid-bob" })]),
		);

		expect(markers).toContain(family);
		expect(markers).toContain(couple);
	});

	test("a combining-mark bomb is not an emoji and is dropped", () => {
		// One grapheme cluster, ten thousand code units: a cluster count bounds nothing, and
		// the pane would re-wrap the whole thing on every frame.
		const bomb = `a${"\u0301".repeat(10_000)}`;

		expect(reactionMarker(message([reaction({ emoji: bomb })]))).toBe("");
	});

	test("a real multi-part emoji is still short enough to keep", () => {
		// Four people with skin tones: nineteen UTF-16 units, one cluster. The bound must sit
		// above what Signal actually sends.
		const complex = "👨🏽‍👩🏿‍👧🏽‍👦🏿";

		expect(reactionMarker(message([reaction({ emoji: complex })]))).toBe(` ${complex}`);
	});

	test("equal counts order by code unit, not by the host's locale", () => {
		// `localeCompare` without a locale resolves the runtime default, which is host state:
		// the same reactions would draw in a different order on another machine.
		const markers = reactionMarker(
			message([reaction({ emoji: "ä", authorId: "u1" }), reaction({ emoji: "z", authorId: "u2" })]),
		);

		expect(markers).toBe(" z ä");
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
