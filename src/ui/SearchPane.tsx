import { Box, Text } from "ink";
import type { SearchState } from "../app/state";
import { describeAuthor, describeBody, truncate } from "../domain/format";
import type { Message } from "../domain/types";

export interface SearchPaneProps {
	readonly search: SearchState;
	readonly width: number;
	readonly height: number;
}

const HINTS = "type to search · ↑/↓ move · ⏎ open · esc close";

/**
 * Rows the chrome eats inside the border: header, hint, and the "+N more" line.
 * Without reserving them Ink squeezes the results or clips the hint.
 */
const CHROME_ROWS = 3;

/**
 * Window of results to render. It follows the selection, so a result chosen past
 * the first screen is still visible and Enter never opens something unseen.
 */
export function visibleWindow(
	total: number,
	selectedIndex: number,
	capacity: number,
): { readonly start: number; readonly count: number } {
	const count = Math.max(1, capacity);
	if (total <= count) {
		return { start: 0, count: Math.max(0, total) };
	}
	const start = selectedIndex < count ? 0 : Math.min(selectedIndex - count + 1, total - count);
	return { start, count };
}

export function SearchPane({ search, width, height }: SearchPaneProps) {
	// Border takes two rows; the header, hint and overflow line are ours to reserve.
	const capacity = Math.max(1, height - 2 - CHROME_ROWS);
	const window = visibleWindow(search.results.length, search.selectedIndex, capacity);
	const visible = search.results.slice(window.start, window.start + window.count);
	const labelWidth = Math.max(8, width - 6);

	return (
		<Box
			flexDirection="column"
			width={width}
			height={height}
			borderStyle="round"
			borderColor="cyan"
			paddingX={1}
		>
			<Text bold color="cyan">
				{`Search  ${search.query.length > 0 ? search.query : "…"}`}
			</Text>

			{search.ran && search.results.length === 0 ? <Text dimColor>no matches</Text> : null}
			{!search.ran && search.query.length > 0 ? <Text dimColor>searching…</Text> : null}
			{search.query.length === 0 ? <Text dimColor>type to search your history</Text> : null}

			{visible.map((message, index) => {
				const selected = window.start + index === search.selectedIndex;
				// Deleted messages keep their row but never their text.
				const label = `${describeAuthor(message)}: ${describeBody(message)}`;
				return (
					<Box key={message.id} justifyContent="space-between">
						<Text inverse={selected} color={selected ? "green" : "gray"}>
							{selected ? "▸ " : "  "}
							{truncate(label, labelWidth)}
						</Text>
					</Box>
				);
			})}

			{search.results.length > capacity ? (
				<Text dimColor>+{search.results.length - window.start - window.count} more</Text>
			) : null}

			<Text dimColor>{HINTS}</Text>
		</Box>
	);
}

export function searchSummary(messages: readonly Message[]): string {
	return `${messages.length} result${messages.length === 1 ? "" : "s"}`;
}
