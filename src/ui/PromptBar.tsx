import { Box, Text } from "ink";
import type { PromptState } from "../app/state";
import { draftTail } from "../domain/rows";

export interface PromptBarProps {
	readonly prompt: PromptState;
	/** Total pane width, borders included. */
	readonly width?: number;
}

/** Label and trailing hint per kind: the two strings a terminal prompt has room for. */
const LABELS = { reaction: "react › ", edit: "edit › ", delete: "delete › " } as const;
const HINTS = {
	reaction: "  ⏎ send · esc cancel",
	edit: "  ⏎ save · esc cancel",
	delete: "  ⏎ delete for everyone · esc keep",
} as const;

/** What a delete asks, in the place the other two show what was typed. */
const CONFIRM_TEXT = "this message, for everyone?";

/**
 * The open prompt, drawn in the composer's frame so the pane stack above it does not move.
 *
 * One content row, because the frame is three rows high: anything that wraps pushes the prompt
 * out of the top of its own box and spills through the border. So the row is *measured* — the
 * hint is the first thing to go, then the text is tail-truncated — rather than trusted to fit.
 *
 * A terminal has no picker or text editor, so this takes whatever is typed; the use case behind
 * it decides whether that is one emoji, a changed body, or a delete to confirm. The border is
 * cyan, or red for the one prompt that changes things for other people: colour is the only cue
 * a terminal offers that the keyboard is in a different mode.
 */
export function PromptBar({ prompt, width = 80 }: PromptBarProps) {
	const inner = Math.max(8, width - 4);
	const label = LABELS[prompt.kind];
	const confirming = prompt.kind === "delete";
	const cursorCells = confirming ? 0 : 1;
	const body = confirming ? CONFIRM_TEXT : prompt.draft;

	// A hint that does not fit is worse than no hint: it would wrap the row it describes.
	const wanted = HINTS[prompt.kind];
	const hint = inner - label.length - body.length >= wanted.length + 1 ? wanted : "";
	const room = Math.max(1, inner - label.length - cursorCells - hint.length);
	const tail = confirming
		? { text: body.slice(0, room), truncated: body.length > room }
		: draftTail(body, room);
	const empty = !confirming && tail.text.length === 0;

	return (
		<Box borderStyle="round" borderColor={confirming ? "red" : "cyan"} paddingX={1} height={3}>
			<Box>
				<Text color={confirming ? "red" : "cyan"}>{label}</Text>
				{tail.truncated ? <Text dimColor>…</Text> : null}
				<Text>{tail.text}</Text>
				{confirming ? null : <Text color="cyan">▌</Text>}
				{empty ? <Text dimColor> {prompt.kind === "edit" ? "a new body" : "an emoji"}</Text> : null}
				{hint === "" ? null : <Text dimColor>{hint}</Text>}
			</Box>
		</Box>
	);
}
