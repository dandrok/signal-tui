import { displayLine } from "../display";
import type { Clock } from "../format";
import { describeBody, SELF_LABEL } from "../format";
import type { Message, QuotedMessage } from "../types";
import { type DisplayBody, textForDisplay } from "./text";

/**
 * Resolves the message a reply quotes, from the thread the pane already has. Absent when
 * the caller cannot resolve one, and then the quote has no text to show — the cache keeps
 * only the quoted message's identity, never a copy of its words.
 */
export type QuoteLookup = (quote: QuotedMessage) => Message | undefined;

/** What a quote's line says in place of the author, when the payload named nobody. */
const UNKNOWN_QUOTED_AUTHOR = "unknown author";

/**
 * What a quote shows when its target is not in the pane's window.
 *
 * The window is bounded (SQLite hands over the newest 50 messages, memory 200), so the
 * quoted message can be in the durable cache and still be missing here — saying "never
 * cached" would be a claim the pane cannot make, and "not loaded" is the one it can.
 */
export const QUOTE_NOT_LOADED = "not loaded";

/** Lead-in that marks a quoted block, so it cannot be read as the sender's own words. */
const QUOTE_PREFIX = "┃ ";

/**
 * The quoted block above a reply's body, as one bounded row.
 *
 * A quote costs exactly one row however long the text is: the window is fitted in rows
 * and a peer's message is as unbounded as they like, so an oversized quote would push the
 * reply it belongs to out of the pane. `textForDisplay` does the cut, and both the row
 * count and the drawn line come from this one string.
 *
 * The text is the quoted message's own rendering, from the thread the pane already has —
 * the cache keeps only its identity, so a deleted or expired target says so through
 * `describeBody` instead of through a second, drifting copy of those notices. The author
 * is resolved the same way; only when the target is missing does the payload's identity
 * have to stand in for it.
 *
 * A reply that is itself gone draws no quote at all: its row already says "message
 * deleted", "message expired" or "view-once message · not stored", and a line naming what
 * it answered spends the same window on context for words nobody can read. The marker
 * stays in the cache — it is an identity, not content — and this is the boundary where it
 * stops being drawn, which a redelivered envelope cannot undo.
 */
export function quoteForDisplay(
	message: Message,
	innerWidth: number,
	clock: Clock,
	lookup?: QuoteLookup,
): DisplayBody {
	const quote = message.quote;
	if (
		quote === undefined ||
		message.isDeleted ||
		message.isExpired === true ||
		message.isViewOnce === true
	) {
		return { text: "", truncated: false, rows: 0 };
	}
	return quoteBlockFor(quote, lookup, clock, innerWidth);
}

/**
 * The quoted block on its own, for a caller that has the target but no reply row yet: the
 * composer draws it while a reply is being written. `quoteForDisplay` is this plus the rule
 * about rows that are gone, so both surfaces show one composition.
 */
export function quoteBlockFor(
	quote: QuotedMessage,
	lookup: QuoteLookup | undefined,
	clock: Clock,
	innerWidth: number,
): DisplayBody {
	const target = lookup?.(quote);
	const author =
		target !== undefined
			? target.isOutgoing
				? SELF_LABEL
				: displayLine(target.author)
			: quote.authorId === null
				? UNKNOWN_QUOTED_AUTHOR
				: displayLine(quote.authorId);
	const body = target === undefined ? QUOTE_NOT_LOADED : describeBody(target);
	const head = `${QUOTE_PREFIX}${clock(quote.sentAt)} ${author}`;
	return textForDisplay(body.length === 0 ? head : `${head}: ${body}`, 1, innerWidth);
}
