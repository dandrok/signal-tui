import { Box, Text } from "ink";
import { displayName, formatUnread, truncate } from "../domain/format";
import type { Conversation } from "../domain/types";

export interface ConversationListProps {
	readonly conversations: readonly Conversation[];
	readonly selectedIndex: number;
	readonly width: number;
	readonly height: number;
}

export function ConversationList({
	conversations,
	selectedIndex,
	width,
	height,
}: ConversationListProps) {
	const capacity = Math.max(1, height - 3);
	const visible = conversations.slice(0, capacity);
	const labelWidth = Math.max(4, width - 9);

	return (
		<Box
			flexDirection="column"
			width={width}
			borderStyle="round"
			borderColor="gray"
			paddingX={1}
			height={height}
		>
			<Text bold color="cyan">
				Conversations
			</Text>
			{visible.length === 0 ? <Text dimColor>no conversations</Text> : null}
			{visible.map((conversation, index) => {
				const selected = index === selectedIndex;
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
			{conversations.length > capacity ? (
				<Text dimColor>+{conversations.length - capacity} more</Text>
			) : null}
		</Box>
	);
}
