import { type Clock, describeAuthor, headerLine } from "../format";
import { reactionMarker } from "../reactions";
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
 * Whether two messages come from the same sender.
 *
 * The display label is not an identity: two members of a group can both be called "Marta", and
 * folding their messages together would credit one of them with the other's words. `authorId` is
 * what Signal keys a sender by, so it decides whenever both rows carry one; the label is only the
 * fallback for rows cached before it was stored. Outgoing and incoming never mix — your own
 * messages are labelled `You`, and someone may well be called that.
 */
function sameSender(previous: Message, message: Message): boolean {
	if (previous.isOutgoing !== message.isOutgoing) {
		return false;
	}
	if (previous.authorId !== undefined && message.authorId !== undefined) {
		return previous.authorId === message.authorId;
	}
	return describeAuthor(previous) === describeAuthor(message);
}

/**
 * Whether `message` continues the block `previous` started.
 *
 * Three rows never continue a block: a deleted one (its label is the word `deleted`, which names
 * no author, and folding it in would hide the only sign that something used to be there), one
 * carrying a reaction, and one with an author of its own. A reaction is why the marker has to
 * break a run rather than ride on a hidden header: it is somebody's answer to *that* message, and
 * the one place it is drawn is the header row.
 */
export function continuesAuthorRun(previous: Message | undefined, message: Message): boolean {
	if (previous === undefined || previous.isDeleted || message.isDeleted) {
		return false;
	}
	if (reactionMarker(message) !== "") {
		return false;
	}
	const gap = message.sentAt - previous.sentAt;
	return gap >= 0 && gap <= CONTINUED_RUN_MS && sameSender(previous, message);
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
