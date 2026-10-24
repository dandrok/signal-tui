import { Box, Text } from "ink";
import type { Clock } from "../domain/format";
import {
	attachmentsForDisplay,
	bodyForDisplay,
	describeAuthor,
	displayName,
	editedMarker,
	headerLine,
	messageRowCount,
	showsBody,
	textForDisplay,
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
	/** Renders message timestamps; the domain never reads the host timezone. */
	readonly clock: Clock;
}

/** Rows the frame takes: two borders, the title, and the padding rows. */
const CHROME_ROWS = 3;

/**
 * The slice of history that fits: starts at the newest visible message and walks
 * backwards while rows last. `hiddenAbove` is what the user could still scroll
 * into, so the pane can say so instead of looking like the start of the thread.
 *
 * A scroll past the oldest message clamps there rather than emptying the window:
 * a held key must not turn a conversation into "no messages yet".
 */
export function visibleWindow(
	messages: readonly Message[],
	rows: number,
	scroll: number,
	innerWidth: number,
	clock: Clock,
): { readonly start: number; readonly end: number; readonly hiddenAbove: number } {
	if (messages.length === 0) {
		return { start: 0, end: 0, hiddenAbove: 0 };
	}
	const end = Math.min(messages.length, Math.max(1, messages.length - Math.max(0, scroll)));
	let start = end;
	let used = 0;
	// At least one message always renders: a pane showing nothing looks broken
	// when a single message is simply taller than the box.
	while (start > 0) {
		const previous = messages[start - 1];
		if (previous === undefined) {
			break;
		}
		const cost = messageRowCount(previous, innerWidth, clock, rows);
		if (used + cost > rows) {
			break;
		}
		used += cost;
		start -= 1;
	}
	const anchoredStart = start === end ? end - 1 : start;
	return { start: anchoredStart, end, hiddenAbove: anchoredStart };
}

export function MessagePane({
	conversation,
	messages,
	height,
	width = 80,
	scroll = 0,
	isFocused = false,
	clock,
}: MessagePaneProps) {
	const innerWidth = Math.max(8, width - 4);
	const contentRows = Math.max(1, height - CHROME_ROWS);
	// The "older" label costs a row of its own, so the window is measured again
	// once it is known to be needed. The same budget then applies to every row
	// drawn inside: measuring the window tighter than the content is how a message
	// ends up clipped at the top, where `justifyContent="flex-end"` hides it.
	let rowBudget = contentRows;
	let window = visibleWindow(messages, rowBudget, scroll, innerWidth, clock);
	if (window.hiddenAbove > 0) {
		rowBudget = Math.max(1, contentRows - 1);
		window = visibleWindow(messages, rowBudget, scroll, innerWidth, clock);
	}
	const visible = messages.slice(window.start, window.end);

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
			{window.hiddenAbove > 0 ? <Text dimColor>↑ {window.hiddenAbove} older</Text> : null}
			{visible.length === 0 ? <Text dimColor>no messages yet</Text> : null}
			{visible.map((message) => (
				<MessageRow
					key={message.id}
					message={message}
					rowBudget={rowBudget}
					innerWidth={innerWidth}
					clock={clock}
				/>
			))}
		</Box>
	);
}

/**
 * One message, measured against a shared row budget. The order is deliberate:
 * the header is drawn first, then the files, and the body gets whatever is left,
 * so neither a long name nor a long body can hide a peer's filenames.
 */
function MessageRow({
	message,
	rowBudget,
	innerWidth,
	clock,
}: {
	readonly message: Message;
	readonly rowBudget: number;
	readonly innerWidth: number;
	readonly clock: Clock;
}) {
	const fullHeader = headerLine(message, clock);
	const header = textForDisplay(fullHeader, rowBudget, innerWidth);
	const files = attachmentsForDisplay(message, Math.max(0, rowBudget - header.rows), innerWidth);
	const body = bodyForDisplay(
		message,
		Math.max(0, rowBudget - header.rows - files.rows),
		innerWidth,
	);

	return (
		<Box flexDirection="column">
			{header.text === fullHeader ? (
				<Text>
					<Text dimColor>{clock(message.sentAt)} </Text>
					<Text bold>{describeAuthor(message)}</Text>
					{editedMarker(message) === "" ? null : <Text dimColor>{editedMarker(message)}</Text>}
				</Text>
			) : (
				<Text>{header.text}</Text>
			)}
			{showsBody(message) && body.rows > 0 ? (
				<Text dimColor={message.isDeleted}>{body.text}</Text>
			) : null}
			{files.lines.map((line, index) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: files render in the order signal-cli listed them and are replaced as a set, so a position is a stable key here
				<Text key={`${message.id}:${index}`} dimColor>
					{line}
				</Text>
			))}
			{/* Only when a row was actually reserved: with no budget left the marker
			    would push the title or the "older" label out of the pane. */}
			{files.omitted > 0 && files.rows > 0 ? (
				<Text dimColor>
					… +{files.omitted} more {files.omitted === 1 ? "file" : "files"}
				</Text>
			) : null}
		</Box>
	);
}
