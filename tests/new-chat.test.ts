import { describe, expect, test } from "bun:test";
import {
	newChatMatches,
	newChatPlan,
	newChatRow,
	newChatRows,
	typedNumber,
} from "../src/app/usecases/new-chat";
import type { Contact } from "../src/domain/types";

const CONTACTS: readonly Contact[] = [
	{ id: "uuid-marta", name: "Marta", number: "+48600222333", uuid: "uuid-marta" },
	{ id: "uuid-adam", name: "Adam", number: "+48600111222", uuid: "uuid-adam" },
	{
		id: "9f8a7b6c-1111-4111-8111-111111111111",
		name: "Zosia",
		uuid: "9f8a7b6c-1111-4111-8111-111111111111",
	},
];

describe("a typed draft as a number", () => {
	test("keeps a leading plus and drops the punctuation people type", () => {
		expect(typedNumber("+48 600 111 222")).toBe("+48600111222");
		expect(typedNumber("+48 (600) 111-222")).toBe("+48600111222");
		expect(typedNumber("600111222")).toBe("600111222");
	});

	test("refuses what is not an address", () => {
		// A name with digits is a filter, not a number: opening a chat with "Marta 2" would make a
		// typo permanent.
		expect(typedNumber("Marta 2")).toBeNull();
		expect(typedNumber("1234")).toBeNull();
		expect(typedNumber("the office")).toBeNull();
		expect(typedNumber("")).toBeNull();
	});
});

describe("what the picker offers", () => {
	test("an empty draft is the whole roster, alphabetically", () => {
		expect(newChatRows(CONTACTS, "").map((row) => row.name)).toEqual(["Adam", "Marta", "Zosia"]);
	});

	test("a name narrows case-insensitively", () => {
		expect(newChatRows(CONTACTS, "MAR").map((row) => row.name)).toEqual(["Marta"]);
	});

	test("digits find a number however it is spaced", () => {
		expect(newChatRows(CONTACTS, "600 222").map((row) => row.name)).toEqual(["Marta"]);
		expect(newChatRows(CONTACTS, "+48 600 222 333").map((row) => row.name)).toEqual(["Marta"]);
	});

	test("a uuid is not something anyone can type at", () => {
		// Zosia has no number, and the digits inside her uuid are not an address: matching them
		// would offer a stranger for a number nobody meant — and, because a row matched, hide the
		// typed-number row that is the only way to reach the number that was actually typed.
		const rows = newChatRows(CONTACTS, "41118");
		expect(rows.map((row) => row.kind)).toEqual(["number"]);
	});

	test("a typed number is a row of its own", () => {
		const rows = newChatRows(CONTACTS, "+48 600 999 888");
		expect(rows.at(-1)).toEqual({
			kind: "number",
			id: "+48600999888",
			name: "+48600999888",
			detail: "not a contact yet",
		});
	});

	test("a number somebody already answers to is not offered twice", () => {
		// Two rows for one person would make `⏎` a coin toss between "this contact" and "a stranger
		// with their number".
		const rows = newChatRows(CONTACTS, "+48 600 222 333");
		expect(rows.filter((row) => row.kind === "number")).toEqual([]);
		expect(rows.map((row) => row.name)).toEqual(["Marta"]);
	});

	test("a contact with no number is offered, addressed by id", () => {
		const rows = newChatRows(CONTACTS, "zosia");
		expect(rows).toEqual([
			{
				kind: "contact",
				id: "9f8a7b6c-1111-4111-8111-111111111111",
				name: "Zosia",
				detail: "no number: addressed by id",
			},
		]);
	});
});

describe("which row the arrows are on", () => {
	test("a shrinking filter clamps rather than wrapping onto a stranger", () => {
		const { rows, picked } = newChatMatches(CONTACTS, "mar", 5);
		expect(rows.length).toBe(1);
		expect(picked).toBe(0);
	});

	test("nothing matched is an empty pick, not a silent pick of the first contact", () => {
		expect(newChatRow(CONTACTS, "zzzz", 0)).toBeUndefined();
	});
});

describe("what ⏎ does", () => {
	test("opens the picked contact", () => {
		expect(newChatPlan(CONTACTS, "mar", 0)).toEqual({
			kind: "open",
			id: "uuid-marta",
			name: "Marta",
		});
	});

	test("opens a typed number nobody had a name for", () => {
		expect(newChatPlan(CONTACTS, "+48600999888", 0)).toEqual({
			kind: "open",
			id: "+48600999888",
			name: "+48600999888",
		});
	});

	test("says which kind of nothing it found", () => {
		// Two different facts: an account with no contacts at all, and a filter that matched none.
		expect(newChatPlan([], "", 0)).toEqual({
			kind: "refused",
			reason: "no contacts yet: type a phone number to start a chat",
		});
		expect(newChatPlan(CONTACTS, "zzzz", 0)).toEqual({
			kind: "refused",
			reason: "nothing matches that, and it is not a phone number",
		});
	});
});
