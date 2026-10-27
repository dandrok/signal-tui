import { attachmentLine, attachmentsOf } from "../format";
import type { Message } from "../types";
import { wrappedRows } from "./text";

/** File lines that fit a row budget, and how many files were left out. */
export interface DisplayAttachments {
	readonly lines: readonly string[];
	readonly omitted: number;
	/** Rows the lines occupy, marker included. */
	readonly rows: number;
}

/**
 * Attachment lines for a pane with `maxRows` rows to spare. When they do not all fit,
 * whole file lines are dropped to make room for one `+N more files` marker, so a peer's
 * filenames are never silently clipped by ink — the pane says what it is hiding instead.
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
