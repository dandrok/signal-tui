import { type AppState, pointedMessage, selectedConversation } from "../app/state";
import { canDelete } from "../app/usecases/delete";
import { canEdit } from "../app/usecases/edit";
import { canForward } from "../app/usecases/forward";
import { canOpen, engineAttachmentsRoot } from "../app/usecases/open";

/**
 * The status line: what the keyboard does right now.
 *
 * One function, because the line has to agree with the keymap — a hint that names a key the
 * map does not answer is worse than no hint. Kept out of `App.tsx` so the layout stays layout.
 *
 * `openRoot` is where a launch is allowed to reach, and it is a parameter rather than a lookup
 * so the line stays a pure function of what it is given: the verdict for `o` is the same one
 * `openPlan` will give, asked on the cheap (the text of the path, not the disk).
 */
export function hintsFor(
	state: AppState,
	isReplying: boolean,
	openRoot: string = engineAttachmentsRoot(),
): string {
	const isSearching = state.search !== null;
	if (isSearching) {
		return "↑/↓ pick · ⏎ open · esc close";
	}
	if (state.prompt !== null) {
		switch (state.prompt.kind) {
			case "reaction":
				return "⇥/↕ pick · ⏎ send · esc cancel";
			case "edit":
				return "⏎ save · esc cancel";
			case "delete":
				return "⏎ delete for everyone · esc keep";
			case "forward":
				return "⇥/↕ pick · ⏎ send · esc cancel";
			case "attach":
				return "⇥/↕ pick · ⏎ open or send · esc cancel";
			case "open":
				return "⇥/↕ pick · ⏎ open · esc cancel";
			case "new":
				return "⇥/↕ pick · ⏎ open · esc cancel";
		}
	}
	if (state.focus === "composer") {
		return isReplying ? "⏎ send · esc cancel reply · tab panes" : "⏎ send · esc back · tab panes";
	}
	const panes = "tab panes · i compose · / search · q quit";
	return state.focus === "messages"
		? messageHints(state, openRoot)
		: `j/k move · n new · a attach · ${panes}`;
}

/**
 * The message pane's line, which depends on what the pointer is on.
 *
 * `e` and `d` are ours only, so they are advertised only when the pointed message is ours:
 * naming a key that silently does nothing is the same lie as a disabled button that looks
 * enabled. `r`, `x` and `D` work on anyone's message, so they are always there — hiding is a
 * local decision about a row, not a claim about who wrote it — and `f` is there whenever there
 * are words to send on (a message with files is refused out loud, so it is not advertised).
 * `o` is advertised only for a row whose file the engine actually downloaded into its own
 * directory: a file that was never kept, or one named from elsewhere, would be refused.
 */
function messageHints(state: AppState, openRoot: string): string {
	const target = pointedMessage(state);
	const conversation = selectedConversation(state);
	const own = target !== undefined && conversation !== undefined;
	const keys = [
		"j/k select",
		"r reply",
		"x react",
		...(own && canForward(target, conversation.id) ? ["f forward"] : []),
		...(own && canEdit(target, conversation.id) ? ["e edit"] : []),
		...(own && canDelete(target, conversation.id) ? ["d delete"] : []),
		"a attach",
		...(target !== undefined && canOpen(target, openRoot) ? ["o open"] : []),
		"D hide",
		"tab",
		"i",
		"/",
		"q",
	];
	return keys.join(" · ");
}
