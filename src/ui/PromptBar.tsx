import { Box, Text } from "ink";
import { useMemo } from "react";
import type { PromptState } from "../app/state";
import { newChatMatches } from "../app/usecases/new-chat";
import { reactionSuggestions } from "../app/usecases/react";
import { reactionEmojiOf } from "../domain/reactions";
import { draftTail } from "../domain/rows";
import { choiceLine, NO_CONTACTS } from "./prompt-choice";

export interface PromptBarProps {
	readonly prompt: PromptState;
	/** Total pane width, borders included. */
	readonly width?: number;
}

/** Label and trailing hint per kind: the two strings a terminal prompt has room for. */
const LABELS = {
	reaction: "react › ",
	edit: "edit › ",
	delete: "delete › ",
	forward: "forward › ",
	attach: "attach › ",
	open: "open › ",
	new: "new › ",
} as const;
const HINTS = {
	reaction: "  ⏎ send · esc cancel",
	edit: "  ⏎ save · esc cancel",
	delete: "  ⏎ delete for everyone · esc keep",
	forward: "  ⇥/↕ pick · ⏎ send · esc cancel",
	attach: "  ⇥/↕ pick · ⏎ open or send · esc cancel",
	open: "  ⇥/↕ pick · ⏎ open · esc cancel",
	new: "  ⇥/↕ pick · ⏎ open · esc cancel",
} as const;

/** What the one question that takes no input asks, in the place the others show what was typed. */
const DELETE_QUESTION = "this message, for everyone?";

const NO_EMOJI = { emoji: [] as readonly string[], picked: 0 };

/**
 * The open prompt, drawn in the composer's frame so the pane stack above it does not move.
 *
 * One content row, because the frame is three rows high: anything that wraps pushes the prompt
 * out of the top of its own box and spills through the border. So the row is *measured* — the
 * hint is the first thing to go, then the text is tail-truncated — rather than trusted to fit.
 *
 * A terminal has no picker, file browser or text editor, so this takes whatever is typed; the
 * use case behind it decides whether that is one emoji, a changed body, a delete to confirm, a
 * conversation to forward to, or a path to a file. The border is cyan, or red for the one prompt
 * that changes things for other people: colour is the only cue a terminal offers that the
 * keyboard is in a different mode.
 */
export function PromptBar({ prompt, width = 80 }: PromptBarProps) {
	const inner = Math.max(8, width - 4);
	const label = LABELS[prompt.kind];
	// Two of the six ask instead of taking text, and only one of those changes anything for
	// other people: the red frame stays the delete's alone, because colour is the terminal's
	// only way to say "this leaves the machine".
	const confirming = prompt.kind === "delete";
	// The open prompt is a picker with no field: what it has to show is the file it would launch,
	// which `choiceLine` draws, so the row spends its cells there instead of on a caret.
	const choosing = prompt.kind === "open";
	const noCursor = confirming || choosing;
	const cursorCells = noCursor ? 0 : 1;
	const body = confirming ? DELETE_QUESTION : choosing ? "" : prompt.draft;

	// A one-emoji draft needs no picker; anything else (a name, or nothing) shows what it
	// matches, so the row is doing the work the terminal cannot do itself.
	const picker =
		prompt.kind === "reaction" && reactionEmojiOf(prompt.draft) === null
			? reactionSuggestions(prompt.draft, prompt.pick)
			: NO_EMOJI;
	// Each suggestion is two cells plus a space, and the picked one is bracketed.
	const chips = picker.emoji.reduce((sum, emoji) => sum + emoji.length + 1, 0);

	// The roster is the one list on this row that can hold hundreds of rows, and this component is
	// re-rendered by things that have nothing to do with it — a typing notice, a receipt landing.
	// Matching is therefore keyed on the three values that can change the answer, so the frames in
	// between do no roster work at all.
	const newChat = useMemo(
		() =>
			prompt.kind === "new"
				? newChatMatches(prompt.contacts ?? NO_CONTACTS, prompt.draft, prompt.pick)
				: null,
		[prompt.kind, prompt.contacts, prompt.draft, prompt.pick],
	);

	// The row has one line to spend on a choice, so it shows the *picked* one and its position
	// in the list: `anna 2/5` says both where `⏎` goes and that the arrows have somewhere to go.
	const { destination, picked } = choiceLine(prompt, newChat);
	const destinationCells = destination.length === 0 ? 0 : destination.length + 1;

	// A hint that does not fit is worse than no hint: it would wrap the row it describes.
	const wanted = HINTS[prompt.kind];
	const used = label.length + body.length + chips + destinationCells;
	const hint = inner - used >= wanted.length + 1 ? wanted : "";
	const room = Math.max(
		1,
		inner - label.length - cursorCells - hint.length - chips - destinationCells,
	);
	const tail = noCursor
		? { text: body.slice(0, room), truncated: body.length > room }
		: draftTail(body, room);
	const empty = !noCursor && tail.text.length === 0;

	return (
		<Box borderStyle="round" borderColor={confirming ? "red" : "cyan"} paddingX={1} height={3}>
			<Box>
				<Text color={confirming ? "red" : "cyan"}>{label}</Text>
				{tail.truncated ? <Text dimColor>…</Text> : null}
				<Text>{tail.text}</Text>
				{noCursor ? null : <Text color="cyan">▌</Text>}
				{empty && prompt.kind === "edit" ? <Text dimColor> a new body</Text> : null}
				{picker.emoji.map((emoji, index) => (
					<Text key={emoji} {...(index === picker.picked ? { inverse: true } : {})}>
						{` ${emoji}`}
					</Text>
				))}
				{destination === "" ? null : (
					<Text {...(picked ? { inverse: true } : { dimColor: true })}>{` ${destination}`}</Text>
				)}
				{hint === "" ? null : <Text dimColor>{hint}</Text>}
			</Box>
		</Box>
	);
}
