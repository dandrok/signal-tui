import type { Clock } from "../../domain/format";
import { messageRowCount, type QuoteLookup } from "../../domain/rows";
import type { Message, MessageId } from "../../domain/types";

/** What marks the message `r` would answer: one row, and part of the measured header. */
export const CURSOR_MARKER = "▸ ";

export interface Window {
	readonly start: number;
	readonly end: number;
	readonly hiddenAbove: number;
}

/**
 * The slice of history that fits: starts at the newest visible message and walks backwards
 * while rows last. `hiddenAbove` is what the user could still scroll into, so the pane can say
 * so instead of looking like the start of the thread.
 *
 * A scroll past the oldest message clamps there rather than emptying the window: a held key
 * must not turn a conversation into "no messages yet". And at least one message always renders,
 * because a pane showing nothing looks broken when one message is simply taller than the box.
 */
export function visibleWindow(
	messages: readonly Message[],
	rows: number,
	scroll: number,
	innerWidth: number,
	clock: Clock,
	lookup?: QuoteLookup,
	cursorId?: MessageId,
): Window {
	if (messages.length === 0) {
		return { start: 0, end: 0, hiddenAbove: 0 };
	}
	const end = Math.min(messages.length, Math.max(1, messages.length - Math.max(0, scroll)));
	let start = end;
	let used = 0;
	while (start > 0) {
		const previous = messages[start - 1];
		if (previous === undefined) {
			break;
		}
		const marker = previous.id === cursorId ? CURSOR_MARKER : "";
		const cost = messageRowCount(previous, innerWidth, clock, rows, lookup, marker);
		if (used + cost > rows) {
			break;
		}
		used += cost;
		start -= 1;
	}
	const anchoredStart = start === end ? end - 1 : start;
	return { start: anchoredStart, end, hiddenAbove: anchoredStart };
}
