import type { Clock } from "../format";
import type { Message } from "../types";

/**
 * The row above a message, when the day changed.
 *
 * A thread shows `14:03` and nothing else, so a conversation that runs past midnight — or one you
 * scroll back into — has no way to say which day you are reading. One divider row answers it, and
 * it is decided in one place so the window's row budget and the pane cannot disagree about
 * whether it exists.
 */
export type Separator =
	| { readonly kind: "none" }
	| { readonly kind: "day"; readonly label: string };

export const NO_SEPARATOR: Separator = { kind: "none" };

/** Rows the separator costs: one for a divider, none otherwise. */
export function separatorRows(separator: Separator): number {
	return separator.kind === "none" ? 0 : 1;
}

/**
 * Which separator belongs above `message`, given the one before it.
 *
 * Only a day change earns a row. Blank space between speakers was the other candidate and lost:
 * it is decoration, it costs a row that a quote or a body needs, and at three rows of pane it is
 * the row that pushes the message out. A new speaker already starts with a header, which is the
 * row that says who is talking.
 */
export function separatorFor(
	previous: Message | undefined,
	message: Message,
	clock: Clock,
): Separator {
	if (previous === undefined) {
		return NO_SEPARATOR;
	}
	return clock.dayKey(previous.sentAt) === clock.dayKey(message.sentAt)
		? NO_SEPARATOR
		: { kind: "day", label: clock.dayLabel(message.sentAt) };
}
