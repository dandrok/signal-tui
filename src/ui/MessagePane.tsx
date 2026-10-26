import { Box, Text } from "ink";
import { useMemo } from "react";
import type { Clock } from "../domain/format";
import { describeAuthor, displayName, headerLine, headerSuffix, showsBody } from "../domain/format";
import type { QuoteLookup } from "../domain/layout";
import {
	attachmentsForDisplay,
	bodyForDisplay,
	messageRowCount,
	quoteForDisplay,
	textForDisplay,
} from "../domain/layout";
import type { Conversation, Message, MessageId, QuotedMessage } from "../domain/types";

/** What marks the message `r` would answer: one row, and part of the measured header. */
export const CURSOR_MARKER = "▸ ";

export interface MessagePaneProps {
	readonly conversation: Conversation | undefined;
	readonly messages: readonly Message[];
	readonly height: number;
	/** Total pane width, borders included. */
	readonly width?: number;
	/** Messages hidden above the window; `0` is pinned to the newest. */
	readonly scroll?: number;
	/** The message `r` would answer, drawn with a marker on its header. */
	readonly cursorId?: MessageId | undefined;
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
	lookup?: QuoteLookup,
	cursorId?: MessageId,
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
		const marker = previous.id === cursorId ? CURSOR_MARKER : "";
		const cost = messageRowCount(previous, innerWidth, clock, rows, lookup, marker);
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
	cursorId,
	isFocused = false,
	clock,
}: MessagePaneProps) {
	const innerWidth = Math.max(8, width - 4);
	const contentRows = Math.max(1, height - CHROME_ROWS);
	// The thread is indexed once per render pass, not once per keystroke: a quote names its
	// target by timestamp, and the label it shows lives on that other row. Building this
	// map here keeps every frame at O(visible rows) afterwards — the pane would otherwise
	// rescan the whole conversation for each quoted message it draws.
	//
	// One entry per timestamp is enough because a message's id *is* its conversation and
	// instant (`<conversationId>:<sentAt>`, the primary key), so two rows in one thread can
	// never share a `sentAt` — a second one merges into the first. Pinning that invariant is
	// `tests/map-envelope-quotes.test.ts`'s "two envelopes at the same instant" case; a
	// producer that invented its own id would break it, and this lookup would be the first
	// thing to notice.
	const lookup = useMemo<QuoteLookup>(() => {
		const bySentAt = new Map<number, Message>();
		for (const message of messages) {
			bySentAt.set(message.sentAt, message);
		}
		return (quote: QuotedMessage) => bySentAt.get(quote.sentAt);
	}, [messages]);
	// The "older" label costs a row of its own, so the window is measured again
	// once it is known to be needed. The same budget then applies to every row
	// drawn inside: measuring the window tighter than the content is how a message
	// ends up clipped at the top, where `justifyContent="flex-end"` hides it.
	let rowBudget = contentRows;
	let window = visibleWindow(messages, rowBudget, scroll, innerWidth, clock, lookup, cursorId);
	if (window.hiddenAbove > 0) {
		rowBudget = Math.max(1, contentRows - 1);
		window = visibleWindow(messages, rowBudget, scroll, innerWidth, clock, lookup, cursorId);
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
					lookup={lookup}
					isCursor={message.id === cursorId}
				/>
			))}
		</Box>
	);
}

/**
 * One message, measured against a shared row budget. The order is deliberate:
 * the header is drawn first, then what it quotes, then the files, and the body gets
 * whatever is left, so neither a long name nor a long body can hide a peer's filenames.
 */
function MessageRow({
	message,
	rowBudget,
	innerWidth,
	clock,
	lookup,
	isCursor,
}: {
	readonly message: Message;
	readonly rowBudget: number;
	readonly innerWidth: number;
	readonly clock: Clock;
	readonly lookup: QuoteLookup;
	readonly isCursor: boolean;
}) {
	// Measured and drawn from one string: the marker is inside `fullHeader`, which is what
	// `messageRowCount` measured the window with.
	const marker = isCursor ? CURSOR_MARKER : "";
	const fullHeader = headerLine(message, clock, marker);
	// The suffix is one string for measurement and render: `headerLine` composes exactly
	// clock + space + author + suffix, so a marker cannot be counted and not drawn.
	const suffix = headerSuffix(message);
	const header = textForDisplay(fullHeader, rowBudget, innerWidth);
	// Same budget arithmetic as `messageOverheadRows`, which is what fitted the window:
	// header, then the quote, then the files, and the body takes the rest. `quoteForDisplay`
	// has already bounded itself to one row at this width, so the budget can only drop it.
	const quote = quoteForDisplay(message, innerWidth, clock, lookup);
	const quoteRows = Math.min(quote.rows, Math.max(0, rowBudget - header.rows));
	const files = attachmentsForDisplay(
		message,
		Math.max(0, rowBudget - header.rows - quoteRows),
		innerWidth,
	);
	const body = bodyForDisplay(
		message,
		Math.max(0, rowBudget - header.rows - quoteRows - files.rows),
		innerWidth,
	);

	return (
		<Box flexDirection="column">
			{header.text === fullHeader ? (
				<Text>
					{marker === "" ? null : <Text color="cyan">{marker}</Text>}
					<Text dimColor>{clock(message.sentAt)} </Text>
					<Text bold>{describeAuthor(message)}</Text>
					{suffix === "" ? null : <Text dimColor>{suffix}</Text>}
				</Text>
			) : (
				<Text>{header.text}</Text>
			)}
			{quoteRows > 0 ? <Text dimColor>{quote.text}</Text> : null}
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
