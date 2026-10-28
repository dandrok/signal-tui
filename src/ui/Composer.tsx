import { Box, Text } from "ink";
import { displayLine } from "../domain/display";
import type { Clock } from "../domain/format";
import { truncate } from "../domain/format";
import { draftTail, quoteBlockFor } from "../domain/rows";
import type { Message } from "../domain/types";

export interface ComposerProps {
	readonly draft: string;
	readonly isFocused: boolean;
	/** Total pane width, borders included. */
	readonly width?: number;
	/** The message this draft answers, drawn above the input row. */
	readonly replyTo?: Message | undefined;
	readonly clock?: Clock;
	/** Who is writing in this thread, or null. Fills the empty row, and nothing else. */
	readonly typing?: string | null;
}

/** Frame plus one typing line. Fixed so the pane stack above it never jumps. */
export const COMPOSER_HEIGHT = 3;

/** One more row while a reply is being written: the quoted block sits above the prompt. */
export const REPLYING_COMPOSER_HEIGHT = COMPOSER_HEIGHT + 1;

/** `› ` prompt, the block cursor, and the marker for a draft with earlier lines. */
const PROMPT_CELLS = 2;
const CURSOR_CELLS = 1;
const ELLIPSIS_CELLS = 1;

/** `Mum is typing…` fitted to the row: the verb survives, the name is what gets cut. */
function typingLine(author: string, cells: number): string {
	const suffix = " is typing…";
	const name = displayLine(author);
	return cells <= suffix.length
		? truncate(`${name}${suffix}`, cells)
		: `${truncate(name, cells - suffix.length)}${suffix}`;
}

/**
 * The input box. Focus is shown three ways — border colour, the `›` prompt and
 * the block cursor — because a terminal gives no caret to rely on.
 *
 * Only the tail of a long draft is drawn: the box is one row, so rendering the
 * whole draft would wrap, overflow and scroll the cursor out of sight.
 */
export function Composer({
	draft,
	isFocused,
	width = 80,
	replyTo,
	clock,
	typing = null,
}: ComposerProps) {
	const empty = draft.length === 0;
	const inner = Math.max(8, width - 4);
	const room = Math.max(1, inner - PROMPT_CELLS - CURSOR_CELLS);
	// Measuring twice: knowing the draft does not fit is what makes room for the
	// ellipsis, which costs the cell that decides whether it fits.
	const measured = draftTail(draft, room);
	const tail = measured.truncated ? draftTail(draft, Math.max(1, room - ELLIPSIS_CELLS)) : measured;
	// One composition for the quoted block, shared with the pane: the composer resolves the
	// target it already holds, so the line says the same thing the thread does.
	const quote =
		replyTo === undefined || clock === undefined
			? undefined
			: quoteBlockFor(
					{ sentAt: replyTo.sentAt, authorId: replyTo.authorId ?? null },
					() => replyTo,
					clock,
					inner,
				);

	return (
		<Box
			flexDirection="column"
			borderStyle="round"
			borderColor={isFocused ? "green" : "gray"}
			paddingX={1}
			height={quote === undefined ? COMPOSER_HEIGHT : REPLYING_COMPOSER_HEIGHT}
		>
			{quote === undefined ? null : <Text dimColor>{quote.text}</Text>}
			<Box>
				<Text color={isFocused ? "green" : "gray"}>{isFocused ? "› " : "  "}</Text>
				{tail.truncated ? <Text dimColor>…</Text> : null}
				<Text dimColor={!isFocused}>{tail.text}</Text>
				{isFocused ? <Text color="green">▌</Text> : null}
				{/* The empty row says who is writing before it says how to write: while someone
				    else is mid-sentence that is the more useful fact, and the composer is the one
				    place a terminal has for it without spending a row of the thread. */}
				{empty && typing !== null ? (
					<Text dimColor>{typingLine(typing, room)}</Text>
				) : !isFocused && empty ? (
					<Text dimColor>i to write</Text>
				) : null}
			</Box>
		</Box>
	);
}
