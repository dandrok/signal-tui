import { Box, Text } from "ink";
import type { PromptState } from "../app/state";
import { forwardMatches } from "../app/usecases/forward";
import { newChatMatches } from "../app/usecases/new-chat";
import { reactionSuggestions } from "../app/usecases/react";
import { displayLine } from "../domain/display";
import { displayName, formatBytes, truncate } from "../domain/format";
import { reactionEmojiOf } from "../domain/reactions";
import { draftTail } from "../domain/rows";
import type { Conversation } from "../domain/types";

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

/** Cells a name may take before it is cut: a picked row, not a list. */
const NAME_CELLS = 22;
/** Cells the number under it may take: `+48600222333` fits, a long uuid is cut. */
const NUMBER_CELLS = 16;

const NO_EMOJI = { emoji: [] as readonly string[], picked: 0 };
const NO_CHATS: readonly Conversation[] = [];

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

	// The row has one line to spend on a choice, so it shows the *picked* one and its position
	// in the list: `anna 2/5` says both where `⏎` goes and that the arrows have somewhere to go.
	const { destination, picked } = choiceLine(prompt);
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

/**
 * The one choice the row can name: a conversation for a forward, a file for an attach.
 *
 * `picked` says whether it is a real entry or a message about having none, because the row draws
 * the two differently — an inverted row is a choice, a dim one is a sentence.
 */
function choiceLine(prompt: PromptState): {
	readonly destination: string;
	readonly picked: boolean;
} {
	if (prompt.kind === "forward") {
		const { matches, picked } = forwardMatches(prompt.chats ?? NO_CHATS, prompt.draft, prompt.pick);
		const chosen = matches[picked];
		return chosen === undefined
			? { destination: "no chat matches", picked: false }
			: {
					destination: `${truncate(displayName(chosen), NAME_CELLS)} ${picked + 1}/${matches.length}`,
					picked: true,
				};
	}
	if (prompt.kind === "open") {
		const files = prompt.files;
		if (files === undefined || files.length === 0) {
			// Nothing to offer: the prompt is only opened with a list, so this is the frame before
			// the list arrives, and saying nothing is truer than naming a file that is not there.
			return { destination: "", picked: false };
		}
		const chosen = files[Math.min(Math.max(0, prompt.pick), files.length - 1)];
		return chosen === undefined
			? { destination: "", picked: false }
			: {
					destination: `${truncate(displayLine(chosen.name), NAME_CELLS)} ${prompt.pick + 1}/${files.length}`,
					picked: true,
				};
	}
	if (prompt.kind === "new") {
		const contacts = prompt.contacts;
		if (contacts === undefined) {
			// The picker asked the engine and has not been answered yet: saying nothing would look
			// like an account with no contacts, which is a different and much worse fact.
			return { destination: "reading contacts…", picked: false };
		}
		const { rows, picked } = newChatMatches(contacts, prompt.draft, prompt.pick);
		const chosen = rows[picked];
		return chosen === undefined
			? {
					destination: contacts.length === 0 ? "no contacts yet" : "nothing matches",
					picked: false,
				}
			: {
					// The number rides along with the name: two people can share a first name, and the
					// row this picker is choosing between is addressed by the number, not by the word.
					destination: `${truncate(chosen.name, NAME_CELLS)} ${truncate(chosen.detail, NUMBER_CELLS)} ${picked + 1}/${rows.length}`,
					picked: true,
				};
	}
	if (prompt.kind === "attach") {
		const paths = prompt.paths;
		if (paths === undefined) {
			// The listing arrives with the keystroke that opened the prompt; before that there
			// is nothing true to say about it.
			return { destination: "", picked: false };
		}
		const chosen = paths[prompt.pick];
		if (chosen === undefined) {
			return { destination: "no file matches", picked: false };
		}
		// A directory ends in a slash and has no size; a file carries the number that decides
		// whether sending it is a good idea.
		const size = chosen.isDirectory || chosen.size === null ? "" : ` ${formatBytes(chosen.size)}`;
		const name = `${truncate(chosen.name, NAME_CELLS)}${chosen.isDirectory ? "/" : ""}`;
		return { destination: `${name}${size} ${prompt.pick + 1}/${paths.length}`, picked: true };
	}
	return { destination: "", picked: false };
}
