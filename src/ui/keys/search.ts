import type { AppState } from "../../app/state";
import { action, type KeyLike, type KeyResult } from "./types";

/**
 * Search owns the keyboard while it is open: every printable key narrows the query, and the
 * arrows move through what came back. `App` never sees these keystrokes.
 */
export function searchKey(state: AppState, input: string, key: KeyLike): KeyResult {
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
}
