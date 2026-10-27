import wrapAnsi from "wrap-ansi";

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
	const lines = wrapAnsi(cut ? draft.slice(-limit) : draft, cells, {
		trim: false,
		hard: true,
	}).split("\n");
	return { text: lines[lines.length - 1] ?? "", truncated: cut || lines.length > 1 };
}
