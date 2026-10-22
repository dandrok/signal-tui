import { Box, Text } from "ink";
import { describeAuthor, describeBody, formatClock } from "../domain/format";
import type { Conversation, Message } from "../domain/types";

export interface MessagePaneProps {
	readonly conversation: Conversation | undefined;
	readonly messages: readonly Message[];
	readonly height: number;
}

export function MessagePane({ conversation, messages, height }: MessagePaneProps) {
	const capacity = Math.max(1, height - 4);
	const visible = messages.slice(-capacity);

	return (
		<Box
			flexDirection="column"
			flexGrow={1}
			borderStyle="round"
			borderColor="gray"
			paddingX={1}
			height={height}
		>
			<Text bold color="cyan">
				{conversation ? conversation.name : "—"}
			</Text>
			{visible.length === 0 ? <Text dimColor>no messages yet</Text> : null}
			{visible.map((message) => (
				<Box key={message.id} flexDirection="column">
					<Text>
						<Text dimColor>{formatClock(message.sentAt)} </Text>
						<Text bold>{describeAuthor(message)}</Text>
					</Text>
					<Text dimColor={message.isDeleted}>{describeBody(message)}</Text>
				</Box>
			))}
		</Box>
	);
}
