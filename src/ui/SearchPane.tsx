import { Box, Text } from "ink";
import type { SearchState } from "../app/state";
import { describeAuthor, truncate } from "../domain/format";
import type { Message } from "../domain/types";

export interface SearchPaneProps {
	readonly search: SearchState;
	readonly width: number;
	readonly height: number;
}

const HINTS = "type to search · ↑/↓ move · ⏎ open · esc close";

export function SearchPane({ search, width, height }: SearchPaneProps) {
	const capacity = Math.max(1, height - 3);
	const visible = search.results.slice(0, capacity);
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
				const selected = index === search.selectedIndex;
				const label = `${describeAuthor(message)}: ${message.body}`;
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
				<Text dimColor>+{search.results.length - capacity} more</Text>
			) : null}

			<Text dimColor>{HINTS}</Text>
		</Box>
	);
}

export function searchSummary(messages: readonly Message[]): string {
	return `${messages.length} result${messages.length === 1 ? "" : "s"}`;
}
