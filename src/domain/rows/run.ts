import { type Clock, describeAuthor, headerLine } from "../format";
import type { Message } from "../types";

/**
 * A run of messages from one author, drawn as one block.
 *
 * Five minutes is the line between "still talking" and "a new thought later". A chat that
 * repeats the author's name on every line of a burst reads as a log, and every name it repeats
 * is a row the thread could have spent on a message instead.
 */
export const CONTINUED_RUN_MS = 5 * 60_000;

/**
 * Whether `message` continues the block `previous` started.
 *
 * A deleted row never continues anything, in either direction: its label is the word `deleted`,
 * which names no author, and folding it into the row above would hide the only sign that
 * something used to be there.
 */
export function continuesAuthorRun(previous: Message | undefined, message: Message): boolean {
	if (previous === undefined || previous.isDeleted || message.isDeleted) {
		return false;
	}
	const gap = message.sentAt - previous.sentAt;
	return (
		gap >= 0 && gap <= CONTINUED_RUN_MS && describeAuthor(previous) === describeAuthor(message)
	);
}

/**
 * The header row a message spends, or nothing when it continues the block above.
 *
 * The reply cursor is the one exception: `▸` is the only thing pointing at the row `r` would
 * answer, so a row carrying it draws its header even when it would otherwise be folded in.
 * Both the pane's measurement and the row itself come through here, so a hidden header cannot
 * be counted in one place and drawn in another.
 */
export function headerTextFor(
	message: Message,
	previous: Message | undefined,
	clock: Clock,
	marker = "",
): string {
	if (marker === "" && continuesAuthorRun(previous, message)) {
		return "";
	}
	return headerLine(message, clock, marker);
}
