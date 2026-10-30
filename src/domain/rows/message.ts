import type { Clock } from "../format";
import { attachmentLine, attachmentsOf, showsBody } from "../format";
import type { Message } from "../types";
import { bodyForDisplay } from "./body";
import { type QuoteLookup, quoteForDisplay } from "./quote";
import { headerTextFor } from "./run";
import { wrappedRows } from "./text";

/**
 * Rows a message spends before its body: the header (a long author name wraps, and a message
 * that continues the block above spends none at all), the quoted block, and one line per file
 * (filenames wrap too). The body gets what is left, so an oversized body cannot push its own
 * attachments out of the pane.
 */
export function messageOverheadRows(
	message: Message,
	innerWidth: number,
	clock: Clock,
	lookup?: QuoteLookup,
	marker = "",
	previous?: Message,
): number {
	const width = Math.max(1, innerWidth);
	const header = headerTextFor(message, previous, clock, marker);
	const quoted = quoteForDisplay(message, width, clock, lookup).rows;
	const files = message.isDeleted
		? 0
		: attachmentsOf(message).reduce(
				(total, attachment) => total + wrappedRows(attachmentLine(attachment), width),
				0,
			);
	// A continued message has no header row at all, so an empty string must cost nothing:
	// wrapping it would count the blank line the pane does not draw.
	return (header === "" ? 0 : wrappedRows(header, width)) + quoted + files;
}

/**
 * Rows a message occupies in a pane whose text area is `innerWidth` columns:
 * overhead plus the body, never more than the pane itself. The message pane fits
 * a window in rows, so counting messages instead of rows silently clips the
 * newest ones — and those are the ones being read.
 */
export function messageRowCount(
	message: Message,
	innerWidth: number,
	clock: Clock,
	maxRows = 60,
	lookup?: QuoteLookup,
	marker = "",
	previous?: Message,
): number {
	const rows = Math.max(1, maxRows);
	const overhead = messageOverheadRows(message, innerWidth, clock, lookup, marker, previous);
	const budget = Math.max(0, rows - overhead);
	const body = showsBody(message) ? bodyForDisplay(message, budget, innerWidth) : { rows: 0 };
	return Math.min(rows, overhead + body.rows);
}
