import { Box, Text } from "ink";
import { draftTail } from "../domain/layout";

export interface ComposerProps {
	readonly draft: string;
	readonly isFocused: boolean;
	/** Total pane width, borders included. */
	readonly width?: number;
}

/** Frame plus one typing line. Fixed so the pane stack above it never jumps. */
export const COMPOSER_HEIGHT = 3;

/** `› ` prompt, the block cursor, and the marker for a draft with earlier lines. */
const PROMPT_CELLS = 2;
const CURSOR_CELLS = 1;
const ELLIPSIS_CELLS = 1;

/**
 * The input box. Focus is shown three ways — border colour, the `›` prompt and
 * the block cursor — because a terminal gives no caret to rely on.
 *
 * Only the tail of a long draft is drawn: the box is one row, so rendering the
 * whole draft would wrap, overflow and scroll the cursor out of sight.
 */
export function Composer({ draft, isFocused, width = 80 }: ComposerProps) {
	const empty = draft.length === 0;
	const inner = Math.max(8, width - 4);
	const room = Math.max(1, inner - PROMPT_CELLS - CURSOR_CELLS);
	// Measuring twice: knowing the draft does not fit is what makes room for the
	// ellipsis, which costs the cell that decides whether it fits.
	const measured = draftTail(draft, room);
	const tail = measured.truncated ? draftTail(draft, Math.max(1, room - ELLIPSIS_CELLS)) : measured;

	return (
		<Box
			flexDirection="column"
			borderStyle="round"
			borderColor={isFocused ? "green" : "gray"}
			paddingX={1}
			height={COMPOSER_HEIGHT}
		>
			<Box>
				<Text color={isFocused ? "green" : "gray"}>{isFocused ? "› " : "  "}</Text>
				{tail.truncated ? <Text dimColor>…</Text> : null}
				<Text dimColor={!isFocused}>{tail.text}</Text>
				{isFocused ? <Text color="green">▌</Text> : null}
				{!isFocused && empty ? <Text dimColor>i to write</Text> : null}
			</Box>
		</Box>
	);
}
