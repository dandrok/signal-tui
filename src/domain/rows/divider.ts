import { truncate } from "../format";

/**
 * A date divider, sized to the pane: `──── Fri 30 Oct ────`.
 *
 * Composed next to the other row builders, so the row the window budgets for is the row that gets
 * drawn. When the label cannot fit it is truncated rather than left to wrap: a divider is the one
 * row that must never grow, because nothing below it would move out of its way.
 */
export function dayDividerLine(label: string, width: number): string {
	const core = ` ${label} `;
	const room = Math.max(0, width - core.length);
	if (room < 2) {
		return truncate(label, Math.max(1, width));
	}
	const left = Math.floor(room / 2);
	return `${"─".repeat(left)}${core}${"─".repeat(room - left)}`;
}
