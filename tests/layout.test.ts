import { describe, expect, test } from "bun:test";
import { frameLayout, MAX_STATUS_ROWS } from "../src/ui/layout";

/**
 * The split has one invariant worth pinning: the boxes it returns add up to the terminal the
 * layout was asked for. `bodyHeight + statusRows === rows` is the whole frame, and the message
 * pane plus the composer is `bodyHeight`. Every assertion here is that arithmetic, because a
 * split that sums to `rows + 1` is a frame ink redraws one row off.
 */

const HINTS =
	"j/k select · r reply · x react · f forward · e edit · d delete · a attach · D hide · tab · i · / · q";

describe("frameLayout", () => {
	test("gives a one-row status line when the hints fit", () => {
		const layout = frameLayout(120, 40, "j/k move · q quit", 3);
		expect(layout.statusRows).toBe(1);
		expect(layout.bodyHeight + layout.statusRows).toBe(40);
		expect(layout.messageHeight + 3).toBe(layout.bodyHeight);
	});

	test("counts the rows a long status line wraps to", () => {
		// 100 cells of hints at 95 columns: one row cannot hold them.
		const layout = frameLayout(95, 45, HINTS, 3);
		expect(layout.statusRows).toBe(2);
		expect(layout.bodyHeight + layout.statusRows).toBe(45);
	});

	test("never lets the status line eat the panes past its cap", () => {
		const narrow = frameLayout(40, 12, `${HINTS} ${HINTS} ${HINTS}`, 3);
		expect(narrow.statusRows).toBe(MAX_STATUS_ROWS);
		expect(narrow.bodyHeight + narrow.statusRows).toBe(12);
		expect(narrow.messageHeight).toBeGreaterThan(0);
	});

	test("measures the message pane against the composer actually drawn", () => {
		const plain = frameLayout(100, 40, "q quit", 3);
		const replying = frameLayout(100, 40, "q quit", 4);
		// A reply costs one row, and the pane above gives it up rather than clipping it.
		expect(replying.messageHeight).toBe(plain.messageHeight - 1);
		expect(replying.messageHeight + 4).toBe(replying.bodyHeight);
	});
});
