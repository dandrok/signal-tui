import { Box, Text } from "ink";
import {
	ATTACHMENT_BODY_PLACEHOLDER,
	attachmentsOf,
	describeAttachment,
	describeAuthor,
	describeBody,
	displayName,
	formatClock,
} from "../domain/format";
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
				{conversation ? displayName(conversation) : "—"}
			</Text>
			{visible.length === 0 ? <Text dimColor>no messages yet</Text> : null}
			{visible.map((message) => (
				<Box key={message.id} flexDirection="column">
					<Text>
						<Text dimColor>{formatClock(message.sentAt)} </Text>
						<Text bold>{describeAuthor(message)}</Text>
					</Text>
					<MessageBody message={message} />
				</Box>
			))}
		</Box>
	);
}

function MessageBody({ message }: { readonly message: Message }) {
	const attachments = attachmentsOf(message);
	// A message that only carried files has a stand-in body: showing both
	// "[attachment]" and the file itself would say the same thing twice. A deleted
	// message always shows its notice, whatever its body used to be.
	const showBody =
		message.isDeleted ||
		(message.body.length > 0 &&
			!(attachments.length > 0 && message.body === ATTACHMENT_BODY_PLACEHOLDER));

	return (
		<>
			{showBody ? <Text dimColor={message.isDeleted}>{describeBody(message)}</Text> : null}
			{message.isDeleted
				? null
				: attachments.map((attachment, index) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: files render in the order signal-cli listed them and are replaced as a set, so a position is a stable key here
						<Text key={`${message.id}:${index}`} dimColor>
							📎 {describeAttachment(attachment)}
						</Text>
					))}
		</>
	);
}
