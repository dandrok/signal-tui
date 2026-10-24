import { render } from "ink-testing-library";
import type { ReactElement } from "react";

/**
 * Ink styles text by wrapping each span in escape sequences, and `lastFrame()`
 * returns them as-is. Whether they are emitted at all depends on chalk's TTY
 * detection, so an assertion like `toContain("10:00 Marta")` passes when the
 * suite runs piped and fails in a terminal, where the clock and the author are
 * separate spans. Strip at the point of inspection: assertions then compare the
 * text a user sees, and the suite keeps running with colour on.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: the escape prefix is the point
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

export const plain = (frame: string): string => frame.replace(ANSI, "");

/** Render once and return the visible frame. */
export function frameOf(element: ReactElement): string {
	const { lastFrame, unmount } = render(element);
	const frame = plain(lastFrame() ?? "");
	unmount();
	return frame;
}
