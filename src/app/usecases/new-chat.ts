import type { Contact } from "../../domain/types";

/**
 * Starting a conversation: one box, two kinds of answer.
 *
 * Signal has no directory — a name that is not in the engine's contacts cannot be found by
 * searching for it — so this picker offers exactly two things: the contacts the account already
 * knows, and a phone number the user typed. Both become a row, and a row either opens a thread or
 * says why it cannot.
 *
 * Nothing here sends anything. The conversation is a local row until the first message makes it
 * real, which is what Signal's own client does and what keeps "start a chat" from needing the
 * network at all.
 */

/** One row the picker can offer: someone known, or a number nobody has a name for yet. */
export interface NewChatRow {
	readonly kind: "contact" | "number";
	/** The conversation id: the contact's number (or uuid), or the typed number. */
	readonly id: string;
	/** The label: the contact's name, or the number itself. */
	readonly name: string;
	/** What is written under the label — the number, or why this row is here. */
	readonly detail: string;
}

/** What a confirmed pick does. */
export type NewChatPlan =
	| { readonly kind: "open"; readonly id: string; readonly name: string }
	| { readonly kind: "refused"; readonly reason: string };

/** The only characters a number is made of; everything else is punctuation people type between them. */
const DIGITS = /\d/g;

/**
 * A typed draft as a number Signal could address, or null when it is not one.
 *
 * Deliberately lax about the country code and strict about the length: `600 111 222` is a local
 * number someone may paste, while `data` and `1234` are not addresses. The minimum of five digits
 * is the shortest national number that exists, and the engine is the one that knows better — this
 * only decides whether to *offer* the row.
 */
export function typedNumber(draft: string): string | null {
	const trimmed = draft.trim();
	if (!/\d/.test(trimmed)) {
		return null;
	}
	// A name with digits in it ("Marta 2") is a filter, not a number: something alphabetic means
	// the user is searching, and opening a chat with "Marta 2" would be a typo made permanent.
	if (/[a-z]/i.test(trimmed)) {
		return null;
	}
	const digits = (trimmed.match(DIGITS) ?? []).join("");
	if (digits.length < 5) {
		return null;
	}
	const plus = trimmed.startsWith("+") ? "+" : "";
	return `${plus}${digits}`;
}

/** Digits only, for comparing two ways of writing the same number. */
function digitsOf(value: string): string {
	return (value.match(DIGITS) ?? []).join("");
}

/**
 * What the picker shows for a draft, in the order it ranks them.
 *
 * An empty draft is every contact, alphabetically — the list is a roster, not a traffic log, so
 * activity order (the conversation list's rule) would be noise here. A draft that contains a
 * letter matches names case-insensitively; a draft that is a number matches the digits of every
 * known number, so `600` finds `+48 600 111 222`.
 */
export function newChatRows(contacts: readonly Contact[], draft: string): readonly NewChatRow[] {
	const filter = draft.trim();
	const byName = /[a-z]/i.test(filter) || filter.length === 0;
	const digits = byName ? "" : digitsOf(filter);
	const matched =
		filter.length === 0
			? contacts
			: contacts.filter((contact) => {
					if (byName) {
						return contact.name.toLowerCase().includes(filter.toLowerCase());
					}
					return digits.length > 0 && digitsOf(contact.number ?? contact.id).includes(digits);
				});
	const rows = [...matched]
		.sort((left, right) => left.name.localeCompare(right.name))
		.map(
			(contact): NewChatRow => ({
				kind: "contact",
				id: contact.id,
				name: contact.name,
				detail: contact.number ?? "no number: addressed by id",
			}),
		);

	const typed = typedNumber(filter);
	// The typed number is the fallback, so it is offered only when the roster had nothing: while
	// someone is still typing a number, "600 222" also matches Marta's `+48 600 222 333`, and a
	// row that says "start a chat with 600222" under it would be an invitation to a wrong number.
	if (typed === null || rows.length > 0) {
		return rows;
	}
	return [{ kind: "number", id: typed, name: typed, detail: "not a contact yet" }];
}

/** The rows a draft matches, and which one the arrows are on. */
export interface NewChatMatches {
	readonly rows: readonly NewChatRow[];
	/** Index into `rows`; 0 when nothing matched. */
	readonly picked: number;
}

/** `pick` is clamped, never wrapped: a filter that shrinks must not land on a stranger. */
export function newChatMatches(
	contacts: readonly Contact[],
	draft: string,
	pick: number,
): NewChatMatches {
	const rows = newChatRows(contacts, draft);
	const picked = rows.length === 0 ? 0 : Math.min(Math.max(0, pick), rows.length - 1);
	return { rows, picked };
}

/** The row `⏎` would take, or undefined when there is nothing to take. */
export function newChatRow(
	contacts: readonly Contact[],
	draft: string,
	pick: number,
): NewChatRow | undefined {
	const { rows, picked } = newChatMatches(contacts, draft, pick);
	return rows[picked];
}

/**
 * What confirming does, in the words the notice would use when it refuses.
 *
 * The refusals are the two states a picker can be in with nothing to pick: an account with no
 * contacts at all, and a filter that matched none of them and is not a number. Both are said out
 * loud, because a key that closes a prompt and opens nothing reads as broken.
 */
export function newChatPlan(
	contacts: readonly Contact[],
	draft: string,
	pick: number,
): NewChatPlan {
	const row = newChatRow(contacts, draft, pick);
	if (row !== undefined) {
		return { kind: "open", id: row.id, name: row.name };
	}
	if (contacts.length === 0) {
		return { kind: "refused", reason: "no contacts yet: type a phone number to start a chat" };
	}
	return { kind: "refused", reason: "nothing matches that, and it is not a phone number" };
}

/** What the status line says once a thread has been opened. */
export function openedNotice(name: string): string {
	return `conversation with ${name}`;
}
