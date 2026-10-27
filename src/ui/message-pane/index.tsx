import { Box, Text } from "ink";
import { useMemo } from "react";
import type { Clock } from "../../domain/format";
import { displayName } from "../../domain/format";
import type { QuoteLookup } from "../../domain/rows";
import type { Conversation, Message, MessageId, QuotedMessage } from "../../domain/types";
import { MessageRow } from "./MessageRow";
import { visibleWindow } from "./window";

/**
 * The thread pane: a window of history, newest at the bottom, with the quoted-author index
 * built once per render pass.
 *
 * The index is the reason this file is not just markup: a quote names its target by timestamp
 * and the label it shows lives on that other row, so the thread is scanned once instead of once
 * per quoted message. One entry per timestamp is enough because a message's id *is* its
 * conversation and instant (`<conversationId>:<sentAt>`, the primary key), so two rows in one
 * thread can never share a `sentAt` — a second one merges into the first. Pinning that
 * invariant is `tests/map-envelope-quotes.test.ts`'s "two envelopes at the same instant" case;
 * a producer that invented its own id would break it, and this lookup would notice first.
 */

/** Rows the frame takes: two borders, the title, and the padding rows. */
const CHROME_ROWS = 3;

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
	const lookup = useMemo<QuoteLookup>(() => {
		const bySentAt = new Map<number, Message>();
		for (const message of messages) {
			bySentAt.set(message.sentAt, message);
		}
		return (quote: QuotedMessage) => bySentAt.get(quote.sentAt);
	}, [messages]);
	// The "older" label costs a row of its own, so the window is measured again once it is
	// known to be needed. The same budget then applies to every row drawn inside: measuring
	// the window tighter than the content is how a message ends up clipped at the top, where
	// `justifyContent="flex-end"` hides it.
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
			// Newest message sits just above the composer, the way a chat reads, instead of
			// leaving a gap under a short thread.
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

export { MessageRow } from "./MessageRow";
export { CURSOR_MARKER, visibleWindow, type Window } from "./window";
