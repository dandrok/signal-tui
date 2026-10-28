import type { AppState } from "../../app/state";
import { composerKey } from "./composer";
import { paneKey } from "./panes";
import { promptKey } from "./prompt";
import { searchKey } from "./search";
import { action, type KeyLike, type KeyResult } from "./types";

export type { KeyLike, KeyResult } from "./types";
export { SCROLL_STEP } from "./types";

/**
 * The keyboard, as a pure function.
 *
 * `App` used to hold a 110-line `useInput` closure where the whole keymap lived beside the
 * layout. The map is now a value: given the state and one keystroke it answers what should
 * happen — and nothing else, because the only side effects it can name are `dispatch` and
 * `exit`. Each mode answers in its own file; this one owns the order they are asked in.
 *
 * Order matters and is part of the contract:
 *   1. `ctrl-c` always quits.
 *   2. Search owns the keyboard while it is open, so nothing below can steal a keystroke.
 *   3. A prompt owns it next — reacting, editing, confirming a delete, forwarding: all four
 *      are modal, so `tab` must not walk away from one.
 *   4. `tab` moves panes before the composer, which would otherwise type it into the draft.
 *   5. The composer takes everything else while it is focused.
 */
export function keyAction(state: AppState, input: string, key: KeyLike): KeyResult {
	if (key.ctrl === true && input === "c") {
		return { kind: "exit" };
	}
	if (state.search !== null) {
		return searchKey(state, input, key);
	}
	if (state.prompt !== null) {
		return promptKey(state, input, key);
	}
	if (key.tab === true) {
		return action({ type: key.shift === true ? "focus-prev" : "focus-next" });
	}
	if (state.focus === "composer") {
		return composerKey(state, input, key);
	}
	return paneKey(state, input, key);
}
