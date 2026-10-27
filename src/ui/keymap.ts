import type { Action, AppState } from "../app/state";

/**
 * The keyboard, as a pure function.
 *
 * `App` used to hold a 110-line `useInput` closure where the whole keymap lived beside the
 * layout. The map is now a value: given the state and one keystroke it answers what should
 * happen — and nothing else, because the only side effects it can name are `dispatch` and
 * `exit`.
 *
 * Order matters and is part of the contract:
 *   1. `ctrl-c` always quits.
 *   2. Search owns the keyboard while it is open, so nothing below can steal a keystroke.
 *   3. `tab` moves panes before the composer, which would otherwise type it into the draft.
 *   4. The composer takes everything else while it is focused.
 */

/** The slice of ink's `Key` this map reads. Structural, so tests need no terminal. */
export interface KeyLike {
	readonly ctrl?: boolean | undefined;
	readonly shift?: boolean | undefined;
	readonly tab?: boolean | undefined;
	readonly escape?: boolean | undefined;
	readonly return?: boolean | undefined;
	readonly backspace?: boolean | undefined;
	readonly delete?: boolean | undefined;
	readonly upArrow?: boolean | undefined;
	readonly downArrow?: boolean | undefined;
	readonly pageUp?: boolean | undefined;
	readonly pageDown?: boolean | undefined;
}

/** What a keystroke asks for: a transition, leaving the app, or nothing at all. */
export type KeyResult =
	| { readonly kind: "action"; readonly action: Action }
	| { readonly kind: "exit" }
	| null;

/** Rows a page of `j`/`k` covers while the message pane owns the keyboard. */
export const SCROLL_STEP = 10;

const action = (next: Action): KeyResult => ({ kind: "action", action: next });

const searchKey = (state: AppState, input: string, key: KeyLike): KeyResult => {
	const query = state.search?.query ?? "";
	if (key.escape === true) {
		return action({ type: "search-closed" });
	}
	if (key.return === true) {
		return action({ type: "search-selected" });
	}
	if (key.upArrow === true) {
		return action({ type: "search-moved", delta: -1 });
	}
	if (key.downArrow === true) {
		return action({ type: "search-moved", delta: 1 });
	}
	if (key.backspace === true || key.delete === true) {
		return action({ type: "search-changed", query: query.slice(0, -1) });
	}
	return input.length > 0 ? action({ type: "search-changed", query: query + input }) : null;
};

const composerKey = (state: AppState, input: string, key: KeyLike): KeyResult => {
	if (key.return === true) {
		return action({ type: "draft-submitted" });
	}
	if (key.escape === true) {
		// A reply is a mode: leaving it drops the target rather than leaving the composer
		// claiming to answer something the next draft is not.
		return action(
			state.replyToId === null ? { type: "focus", focus: "messages" } : { type: "reply-cancelled" },
		);
	}
	if (key.backspace === true || key.delete === true) {
		return action({ type: "draft-changed", value: state.draft.slice(0, -1) });
	}
	return action({ type: "draft-changed", value: state.draft + input });
};

const paneKey = (state: AppState, input: string, key: KeyLike): KeyResult => {
	if (input === "q") {
		return { kind: "exit" };
	}
	if (input === "/") {
		return action({ type: "search-opened" });
	}
	if (input === "i" || key.return === true) {
		return action({ type: "focus", focus: "composer" });
	}

	const inMessages = state.focus === "messages";
	if (inMessages && input === "r") {
		return action({ type: "reply-started" });
	}
	if (inMessages && key.pageUp === true) {
		return action({ type: "scroll-moved", delta: SCROLL_STEP });
	}
	if (inMessages && key.pageDown === true) {
		return action({ type: "scroll-moved", delta: -SCROLL_STEP });
	}
	if (input === "j") {
		return action(
			inMessages ? { type: "scroll-moved", delta: -1 } : { type: "move-selection", delta: 1 },
		);
	}
	if (input === "k") {
		if (!inMessages) {
			return action({ type: "move-selection", delta: -1 });
		}
		// At the top of what is loaded there is nothing left to scroll to: ask for the page
		// above it instead, so history past the first page is reachable at all.
		const loaded = state.messagesByConversation[state.selectedId ?? ""]?.length ?? 0;
		return state.scroll >= loaded - 1
			? action({ type: "older-requested" })
			: action({ type: "scroll-moved", delta: 1 });
	}
	return null;
};

/** What one keystroke does, given the state it arrived in. */
export function keyAction(state: AppState, input: string, key: KeyLike): KeyResult {
	if (key.ctrl === true && input === "c") {
		return { kind: "exit" };
	}
	if (state.search !== null) {
		return searchKey(state, input, key);
	}
	if (key.tab === true) {
		return action({ type: key.shift === true ? "focus-prev" : "focus-next" });
	}
	if (state.focus === "composer") {
		return composerKey(state, input, key);
	}
	return paneKey(state, input, key);
}
