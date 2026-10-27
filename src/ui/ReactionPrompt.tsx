import { Box, Text } from "ink";
import { draftTail } from "../domain/rows";

export interface ReactionPromptProps {
	/** The emoji typed so far. */
	readonly draft: string;
	/** Total pane width, borders included. */
	readonly width?: number;
}

/** `react › ` plus the block cursor, and the hint that says how to leave. */
const PROMPT_CELLS = 8;
const CURSOR_CELLS = 1;
const HINT = "  ⏎ send · esc cancel";

/**
 * The emoji prompt, drawn in the composer's frame so the pane stack above it does not move.
 *
 * One content row, because the frame is three rows high and a second one would push the
 * prompt itself out of the top — the whole box is one line of input, like the composer.
 *
 * A terminal has no picker, so this takes whatever the user types; `reactionEmojiOf` decides
 * whether it is one emoji, and the wiring refuses it otherwise. The border is cyan rather
 * than green: the composer is not what this is, and colour is the only cue a terminal offers
 * that the keyboard is in a different mode.
 */
export function ReactionPrompt({ draft, width = 80 }: ReactionPromptProps) {
	const inner = Math.max(8, width - 4);
	const showHint = inner > 28;
	const room = Math.max(1, inner - PROMPT_CELLS - CURSOR_CELLS - (showHint ? HINT.length : 0));
	const tail = draftTail(draft, room);
	const empty = tail.text.length === 0;

	return (
		<Box borderStyle="round" borderColor="cyan" paddingX={1} height={3}>
			<Box>
				<Text color="cyan">react › </Text>
				{tail.truncated ? <Text dimColor>…</Text> : null}
				<Text>{tail.text}</Text>
				<Text color="cyan">▌</Text>
				{empty ? <Text dimColor> an emoji</Text> : null}
				{showHint ? <Text dimColor>{HINT}</Text> : null}
			</Box>
		</Box>
	);
}
