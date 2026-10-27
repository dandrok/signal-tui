import type { AppState } from "../app/state";

/**
 * The status line: what the keyboard does right now.
 *
 * One function, because the line has to agree with the keymap — a hint that names a key the
 * map does not answer is worse than no hint. Kept out of `App.tsx` so the layout stays layout.
 */
export function hintsFor(state: AppState, isReplying: boolean): string {
	const isSearching = state.search !== null;
	if (isSearching) {
		return "↑/↓ pick · ⏎ open · esc close";
	}
	if (state.focus === "composer") {
		return isReplying ? "⏎ send · esc cancel reply · tab panes" : "⏎ send · esc back · tab panes";
	}
	const panes = "tab panes · i compose · / search · q quit";
	return state.focus === "messages"
		? `j/k select · r reply · ⇞/⇟ page · ${panes}`
		: `j/k move · ${panes}`;
}
