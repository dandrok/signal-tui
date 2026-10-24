import { Box, Text } from "ink";
import {
	attachmentsOf,
	describeAttachment,
	describeAuthor,
	describeBody,
	displayName,
	formatClock,
	messageRowCount,
	showsBody,
} from "../domain/format";
import type { Conversation, Message } from "../domain/types";

export interface MessagePaneProps {
	readonly conversation: Conversation | undefined;
	readonly messages: readonly Message[];
	readonly height: number;
	/** Total pane width, borders included. */
	readonly width?: number;
	/** Messages hidden above the window; `0` is pinned to the newest. */
	readonly scroll?: number;
	readonly isFocused?: boolean;
}

/** Rows the frame takes: two borders, the title, and the padding rows. */
const CHROME_ROWS = 3;

/**
 * The slice of history that fits: starts at the newest visible message and walks
 * backwards while rows last. `hiddenAbove` is what the user could still scroll
 * into, so the pane can say so instead of looking like the start of the thread.
 */
export function visibleWindow(
	messages: readonly Message[],
	rows: number,
	scroll: number,
	innerWidth: number,
): { readonly start: number; readonly end: number; readonly hiddenAbove: number } {
	const end = Math.max(0, messages.length - Math.max(0, scroll));
	let start = end;
	let used = 0;
	// At least one message always renders: an empty-looking pane that says nothing
	// is wrong when a single message is taller than the box.
	while (start > 0) {
		const previous = messages[start - 1];
		if (previous === undefined) {
			break;
		}
		const cost = messageRowCount(previous, innerWidth);
		if (used + cost > rows) {
			break;
		}
		used += cost;
		start -= 1;
	}
	// At least one message always renders: a pane showing nothing looks broken
	// when a single message is simply taller than the box.
	const anchoredStart = start === end && end > 0 ? end - 1 : start;
	return { start: anchoredStart, end, hiddenAbove: anchoredStart };
}

export function MessagePane({
	conversation,
	messages,
	height,
	width = 80,
	scroll = 0,
	isFocused = false,
}: MessagePaneProps) {
	const innerWidth = Math.max(8, width - 4);
	const { start, end, hiddenAbove } = visibleWindow(
		messages,
		Math.max(1, height - CHROME_ROWS),
		scroll,
		innerWidth,
	);
	const visible = messages.slice(start, end);

	return (
		<Box
			flexDirection="column"
			flexGrow={1}
			// Newest message sits just above the composer, the way a chat reads,
			// instead of leaving a gap under a short thread.
			justifyContent="flex-end"
			borderStyle="round"
			borderColor={isFocused ? "cyan" : "gray"}
			paddingX={1}
			height={height}
		>
			<Text bold color={isFocused ? "cyan" : "gray"}>
				{conversation ? displayName(conversation) : "—"}
				{messages.length > 0 ? ` (${messages.length})` : ""}
			</Text>
			{hiddenAbove > 0 ? <Text dimColor>↑ {hiddenAbove} older</Text> : null}
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

	return (
		<>
			{showsBody(message) ? (
				<Text dimColor={message.isDeleted}>{describeBody(message)}</Text>
			) : null}
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
