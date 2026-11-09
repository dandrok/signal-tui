import { wrappedRows } from "../domain/rows";

/**
 * The frame, split into the rows and columns the panes get.
 *
 * This used to be four arithmetic expressions inline in `App`, and one of them was an
 * assumption: that the status line costs exactly one row. It costs as many rows as it wraps
 * to, and it wraps whenever the hint line is longer than the terminal is wide — which is the
 * normal case in the message pane, where the line names `e edit` and `d delete` as well and
 * reaches a hundred cells.
 *
 * The cost of getting it wrong is not cosmetic. The frame is then one row taller than the
 * terminal, the screen scrolls, and ink — which redraws by moving the cursor back over the
 * rows it believes it wrote — lands a row off. Yoga then squeezes the message pane by the
 * overflowing row and its text children overlap: the header carrying the time, the author and
 * the `▸` cursor is overwritten by the next message's body, and a body appears to continue
 * into the one below it. So the split is counted here, in one place, against the one string
 * the status line actually draws.
 */

/** Rows the status line may take before it is clipped rather than allowed to grow further. */
export const MAX_STATUS_ROWS = 3;

/** The list is a fixed, readable band of the width; the thread takes the rest. */
const LIST_MIN_WIDTH = 22;
const LIST_MAX_WIDTH = 32;
const LIST_WIDTH_RATIO = 0.3;

export interface FrameLayout {
	readonly listWidth: number;
	/** Total width of the thread pane, borders included. */
	readonly messageWidth: number;
	/** Rows for the conversation list and the thread pane, above the composer. */
	readonly bodyHeight: number;
	readonly messageHeight: number;
	/** Rows the status line is given, and what the rest of the split is measured after. */
	readonly statusRows: number;
}

/**
 * Split a terminal into the frame's boxes.
 *
 * `bodyHeight + statusRows` is the whole frame and is exactly `rows`: that equality is the
 * point of the function, so it is arithmetic and not a clamp. `statusText` is the string the
 * status line draws — notice and hints composed — measured with the same wrapper the message
 * rows are, because ink will wrap it at the same width and a row counted one short is the bug
 * this exists to prevent.
 *
 * `composerHeight` is whichever composer the state calls for: a reply costs one extra row and
 * the pane above is measured against that, not against a fixed height.
 */
export function frameLayout(
	columns: number,
	rows: number,
	statusText: string,
	composerHeight: number,
): FrameLayout {
	const statusWidth = Math.max(1, columns - 2);
	const statusRows = Math.min(MAX_STATUS_ROWS, Math.max(1, wrappedRows(statusText, statusWidth)));
	// The size hook floors the terminal at twelve rows and the status line at three, so this
	// is nine or more in practice; the floor here keeps the frame's height equal to `rows`
	// even for a caller that hands in something absurd.
	const bodyHeight = Math.max(1, rows - statusRows);
	const messageHeight = Math.max(1, bodyHeight - composerHeight);
	const listWidth = Math.max(
		LIST_MIN_WIDTH,
		Math.min(LIST_MAX_WIDTH, Math.floor(columns * LIST_WIDTH_RATIO)),
	);
	return {
		listWidth,
		messageWidth: Math.max(20, columns - listWidth),
		bodyHeight,
		messageHeight,
		statusRows,
	};
}
