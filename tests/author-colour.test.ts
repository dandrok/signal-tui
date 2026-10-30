import { describe, expect, test } from "bun:test";
import { authorColour } from "../src/ui/message-pane/author-colour";

/**
 * A peer's colour is the only thing that separates five people in a group whose messages are
 * otherwise identical rows, so it has to be stable and it has to spread.
 */

describe("authorColour", () => {
	test("gives the same person the same colour every time", () => {
		expect(authorColour("uuid-marta", "Marta")).toBe(authorColour("uuid-marta", "Marta"));
		// Even when their display label changed, which a transcript does in the middle of a thread.
		expect(authorColour("uuid-marta", "Marta K.")).toBe(authorColour("uuid-marta", "Marta"));
	});

	test("spreads a group over more than one colour", () => {
		const people = ["a", "b", "c", "d", "e", "f"].map((id) =>
			authorColour(`uuid-${id}`, "same label"),
		);
		const distinct = new Set(people);

		expect(distinct.size).toBeGreaterThan(1);
		// Whatever it picks has to be a colour a terminal actually has.
		for (const colour of people) {
			expect(["cyan", "magenta", "yellow", "blue"]).toContain(colour);
		}
	});

	test("falls back to the label for rows cached before sender ids were stored", () => {
		expect(authorColour(undefined, "Marta")).toBe(authorColour(undefined, "Marta"));
		expect(authorColour(undefined, "Marta")).not.toBe("");
	});
});
