import wrapAnsi from "wrap-ansi";

/**
 * Fitting text into a pane measured in rows.
 *
 * Wrapping is delegated to the same options ink uses for `<Text>`, because a hand-rolled
 * `length / width` gets explicit newlines and wide characters (CJK, emoji) wrong, and a
 * window that over-selects hides the newest message. Everything in `rows/` measures the
 * string the pane draws, and `format.ts` is the only place those strings are composed.
 */

/** The options ink's own `wrap` mode uses; matching them keeps the count honest. */
const WRAP = { trim: false, hard: true } as const;

/** Rows `text` occupies when rendered into `width` cells. */
export function wrappedRows(text: string, width: number): number {
	return wrapAnsi(text, width, WRAP).split("\n").length;
}

/** What the pane draws for a body, and where it stops. */
export interface DisplayBody {
	readonly text: string;
	readonly truncated: boolean;
	/** Rows the text actually occupies, so callers can budget around it. */
	readonly rows: number;
}

/**
 * Row-bounded rendering of any single text block: a body, a header, a caption.
 *
 * Counting characters is not enough: a body of nothing but newlines fits any character
 * budget and still renders one row per newline, and a wide character costs two cells. The
 * text is bounded before wrapping — only the first `rows * width` characters can fill
 * `rows` rows at one cell each — so the work stays proportional to what is drawn.
 *
 * The cut is shown rather than hidden, and the marker takes the last row of the budget; a
 * single-row budget has no room for it. The rest of a very long message is not reachable
 * until the pane can scroll by line instead of by message.
 */
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
