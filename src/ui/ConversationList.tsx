import { Box, Text } from "ink";
import { displayName, formatUnread, truncate } from "../domain/format";
import type { Conversation } from "../domain/types";

export interface ConversationListProps {
	readonly conversations: readonly Conversation[];
	readonly selectedIndex: number;
	readonly width: number;
	readonly height: number;
	readonly isFocused?: boolean;
}

/** Rows the frame takes: two borders and the title. */
const CHROME_ROWS = 3;

/**
 * First row of the window. Derived from the selection on every render instead of
 * being stored, so there is no scroll position to drift out of sync on a resize.
 * The selection sits at the top edge while walking down the list and the window
 * stays put while the cursor moves inside it, which is what a pager does.
 */
export function listWindowStart(total: number, capacity: number, selectedIndex: number): number {
	if (total <= capacity) {
		return 0;
	}
	const lastPage = Math.max(0, total - capacity);
	return Math.min(Math.max(0, selectedIndex), lastPage);
}

export function ConversationList({
	conversations,
	selectedIndex,
	width,
	height,
	isFocused = false,
}: ConversationListProps) {
	const capacity = Math.max(1, height - CHROME_ROWS);
	const start = listWindowStart(conversations.length, capacity, selectedIndex);
	const visible = conversations.slice(start, start + capacity);
	const above = start;
	const below = Math.max(0, conversations.length - (start + visible.length));
	const labelWidth = Math.max(4, width - 9);

	return (
		<Box
			flexDirection="column"
			width={width}
			borderStyle="round"
			borderColor={isFocused ? "cyan" : "gray"}
			paddingX={1}
			height={height}
		>
			<Text bold color={isFocused ? "cyan" : "gray"}>
				Conversations
				{above > 0 ? <Text dimColor> ↑{above}</Text> : null}
				{below > 0 ? <Text dimColor> ↓{below}</Text> : null}
			</Text>
			{visible.length === 0 ? <Text dimColor>no conversations</Text> : null}
			{visible.map((conversation, offset) => {
				const selected = start + offset === selectedIndex;
				const badge = formatUnread(conversation.unreadCount);
				return (
					<Box key={conversation.id} justifyContent="space-between">
						<Text inverse={selected} color={selected ? "green" : "gray"}>
							{selected ? "▸ " : "  "}
							{truncate(displayName(conversation), labelWidth)}
						</Text>
						{badge.length > 0 ? <Text color="yellow">{badge}</Text> : null}
					</Box>
				);
			})}
		</Box>
	);
}
