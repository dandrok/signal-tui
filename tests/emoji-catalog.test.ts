import { describe, expect, test } from "bun:test";
import { EMOJI_CATALOG, MAX_SUGGESTIONS, searchEmoji } from "../src/domain/emoji-catalog";

/**
 * The catalogue and its search.
 *
 * The rule this file exists to pin: a name is matched the way people type it, not the way a
 * spec writes it. `red heart`, `redheart` and `:redheart:` all reach ❤️ — the report that
 * started this was somebody typing `redheart` into the prompt and being told it was not an
 * emoji, which is true and useless.
 */
describe("searchEmoji", () => {
	test("an empty query opens the picker at the head of the list", () => {
		const suggestions = searchEmoji("");

		expect(suggestions).toHaveLength(MAX_SUGGESTIONS);
		expect(suggestions[0]?.emoji).toBe("👍");
	});

	test("a name reaches its emoji with or without spaces", () => {
		const heart = EMOJI_CATALOG.find((entry) => entry.emoji === "❤️");

		for (const query of ["heart", "red heart", "redheart", "HEART", " heart ", ":heart:", "love"]) {
			expect(searchEmoji(query)[0]?.emoji, `${query} should reach ❤️`).toBe("❤️");
		}
		expect(heart?.names).toContain("red heart");
	});

	test("an exact name beats a name that merely contains the query", () => {
		// "star" is a prefix of nothing else here, but "heart" is inside "heart hands" and
		// "heart eyes": the exact match has to come first, or the picker would open on a
		// different emoji than the one asked for.
		expect(searchEmoji("heart")[0]?.emoji).toBe("❤️");
		expect(searchEmoji("heart eyes")[0]?.emoji).toBe("😍");
		expect(searchEmoji("hearteyes")[0]?.emoji).toBe("😍");
	});

	test("an exact name outranks a longer one that starts with it", () => {
		// "no" is an exact alias of ❌, and also the start of nothing else — but "cross" and
		// "not" style queries must not reorder the head.
		expect(searchEmoji("no")[0]?.emoji).toBe("❌");
		expect(searchEmoji("check")[0]?.emoji).toBe("✅");
	});

	test("a partial name still finds something, because a picker should not dead-end", () => {
		expect(searchEmoji("laugh").length).toBeGreaterThan(0);
		expect(searchEmoji("lau")[0]?.emoji).toBe("😂");
	});

	test("a query that matches nothing returns nothing, rather than the whole list", () => {
		expect(searchEmoji("zzzz")).toEqual([]);
	});

	test("the limit is honoured", () => {
		expect(searchEmoji("", 2)).toHaveLength(2);
		expect(searchEmoji("heart", 1)).toHaveLength(1);
	});

	test("every entry can be reached by its canonical name", () => {
		// A table is only as good as its consistency: this fails the moment an entry is added
		// with a name that the search cannot resolve back to it.
		for (const entry of EMOJI_CATALOG) {
			const canonical = entry.names[0] ?? "";
			expect(searchEmoji(canonical)[0]?.emoji, `${canonical} -> ${entry.emoji}`).toBe(entry.emoji);
		}
	});

	test("the table has no duplicate emoji and no empty names", () => {
		const emojis = EMOJI_CATALOG.map((entry) => entry.emoji);

		expect(new Set(emojis).size).toBe(emojis.length);
		for (const entry of EMOJI_CATALOG) {
			expect(entry.names.length).toBeGreaterThan(0);
			expect(entry.names.every((name) => name === name.toLowerCase() && name.length > 0)).toBe(
				true,
			);
		}
	});
});
