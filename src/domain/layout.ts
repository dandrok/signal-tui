import wrapAnsi from "wrap-ansi";
import { displayLine } from "./display";
import type { Clock } from "./format";
import {
	attachmentLine,
	attachmentsOf,
	describeBody,
	headerLine,
	SELF_LABEL,
	showsBody,
} from "./format";
import type { Message, QuotedMessage } from "./types";

/**
 * Fitting text into a pane measured in rows.
 *
 * Split out of `format.ts` by responsibility: that file composes the strings a row is made
 * of (a header, a file line, a body), and this one decides how many rows they cost and
 * which of them fit. The two have to agree — a window fitted with one arithmetic and drawn
 * with another clips a message — which is why every function here measures the string the
 * pane draws, and `format.ts` is the only place those strings are composed.
 */

/** File lines that fit a row budget, and how many files were left out. */
export interface DisplayAttachments {
	readonly lines: readonly string[];
	readonly omitted: number;
	/** Rows the lines occupy, marker included. */
	readonly rows: number;
}

/**
 * Attachment lines for a pane with `maxRows` rows to spare. When they do not all
 * fit, whole file lines are dropped to make room for one `+N more files` marker,
 * so a peer's filenames are never silently clipped by ink — the pane says what it
 * is hiding instead.
 */
export function attachmentsForDisplay(
	message: Message,
	maxRows: number,
	innerWidth: number,
): DisplayAttachments {
	// A view-once message keeps no files, so nothing stands in for them either.
	if (message.isDeleted || message.isViewOnce === true) {
		return { lines: [], omitted: 0, rows: 0 };
	}
	const width = Math.max(1, innerWidth);
	const budget = Math.max(0, maxRows);
	const all = attachmentsOf(message);
	const lines: string[] = [];
	const costs: number[] = [];
	let used = 0;
	for (const attachment of all) {
		const line = attachmentLine(attachment);
		const cost = wrappedRows(line, width);
		if (used + cost > budget) {
			break;
		}
		lines.push(line);
		costs.push(cost);
		used += cost;
	}
	let omitted = all.length - lines.length;
	if (omitted === 0) {
		return { lines, omitted: 0, rows: used };
	}
	// The marker is a row of its own: give up a file line until it fits.
	while (used + 1 > budget && lines.length > 0) {
		used -= costs.pop() ?? 0;
		lines.pop();
		omitted += 1;
	}
	if (used + 1 > budget) {
		return { lines: [], omitted: all.length, rows: 0 };
	}
	return { lines, omitted, rows: used + 1 };
}

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

/**
 * Rows a message spends before its body: the header (a long author name wraps), the
 * quoted block, and one line per file (filenames wrap too). The body gets what is left,
 * so an oversized body cannot push its own attachments out of the pane.
 */
export function messageOverheadRows(
	message: Message,
	innerWidth: number,
	clock: Clock,
	lookup?: QuoteLookup,
	marker = "",
): number {
	const width = Math.max(1, innerWidth);
	const header = wrappedRows(headerLine(message, clock, marker), width);
	const quoted = quoteForDisplay(message, width, clock, lookup).rows;
	const files = message.isDeleted
		? 0
		: attachmentsOf(message).reduce(
				(total, attachment) => total + wrappedRows(attachmentLine(attachment), width),
				0,
			);
	return header + quoted + files;
}

/**
 * Rows a message occupies in a pane whose text area is `innerWidth` columns:
 * overhead plus the body, never more than the pane itself. The message pane fits
 * a window in rows, so counting messages instead of rows silently clips the
 * newest ones — and those are the ones being read.
 *
 * Wrapping is delegated to the same options ink uses for `<Text>`, because a
 * hand-rolled `length / width` gets explicit newlines and wide characters (CJK,
 * emoji) wrong, and a window that over-selects hides the newest message.
 */
export function messageRowCount(
	message: Message,
	innerWidth: number,
	clock: Clock,
	maxRows = 60,
	lookup?: QuoteLookup,
	marker = "",
): number {
	const rows = Math.max(1, maxRows);
	const overhead = messageOverheadRows(message, innerWidth, clock, lookup, marker);
	const budget = Math.max(0, rows - overhead);
	const body = showsBody(message) ? bodyForDisplay(message, budget, innerWidth) : { rows: 0 };
	return Math.min(rows, overhead + body.rows);
}

/** What the pane draws for a body, and where it stops. */
export interface DisplayBody {
	readonly text: string;
	readonly truncated: boolean;
	/** Rows the text actually occupies, so callers can budget around it. */
	readonly rows: number;
}

/**
 * Body text cut to `maxRows` wrapped rows. Counting characters is not enough: a
 * body of nothing but newlines fits any character budget and still renders one
 * row per newline, and a wide character costs two cells. The text is bounded
 * before wrapping — only the first `rows * width` characters can fill `rows` rows
 * at one cell each — so the work stays proportional to what is drawn.
 *
 * The cut is shown rather than hidden, and the marker takes the last row of the
 * budget; a single-row budget has no room for it. The rest of a very long message
 * is not reachable until the pane can scroll by line instead of by message.
 */
export function bodyForDisplay(message: Message, maxRows: number, innerWidth: number): DisplayBody {
	return textForDisplay(describeBody(message), maxRows, innerWidth);
}

/** Row-bounded rendering of any single text block: a body, a header, a caption. */
export function textForDisplay(text: string, maxRows: number, innerWidth: number): DisplayBody {
	const width = Math.max(1, innerWidth);
	const rows = Math.max(0, maxRows);
	const full = text;
	if (rows === 0) {
		return { text: "", truncated: full.length > 0, rows: 0 };
	}
	const bounded = full.slice(0, rows * width);
	const lines = wrapAnsi(bounded, width, WRAP).split("\n");
	if (bounded.length === full.length && lines.length <= rows) {
		return { text: lines.join("\n"), truncated: false, rows: lines.length };
	}
	const kept = rows === 1 ? [lines[0] ?? "…"] : [...lines.slice(0, rows - 1), "…"];
	return { text: kept.join("\n"), truncated: true, rows: kept.length };
}

/** The options ink's own `wrap` mode uses; matching them keeps the count honest. */
const WRAP = { trim: false, hard: true } as const;

/** Rows `text` occupies when rendered into `width` cells. */
function wrappedRows(text: string, width: number): number {
	return wrapAnsi(text, width, WRAP).split("\n").length;
}

/** The end of a draft that fits one row, so the cursor is never scrolled away. */
export interface DraftTail {
	/** Text of the last wrapped line. */
	readonly text: string;
	/** True when earlier lines were dropped, so the caller can say so. */
	readonly truncated: boolean;
}

/**
 * Chars examined from the end of a draft. Two lines' worth is enough to find the
 * last line break, and it keeps the work per keystroke bounded: wrapping is O(n),
 * and a pasted message is n = its whole length on every character typed.
 */
const TAIL_WINDOW = 2;

/** The last line of a draft that fits one row, and whether earlier lines were dropped. */
export function draftTail(draft: string, width: number): DraftTail {
	const cells = Math.max(1, width);
	const limit = Math.max(1, cells * TAIL_WINDOW);
	const cut = draft.length > limit;
	const lines = wrapAnsi(cut ? draft.slice(-limit) : draft, cells, WRAP).split("\n");
	return { text: lines[lines.length - 1] ?? "", truncated: cut || lines.length > 1 };
}
