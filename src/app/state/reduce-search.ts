import type { Action, AppState } from "./types";

/**
 * Search is a mode, not a pane: while it is open the keyboard belongs to it.
 *
 * The query is local FTS, so every keystroke runs one; a new query clears the previous hits
 * because showing them would suggest they answer what is being typed now.
 */

type SearchAction = Extract<
	Action,
	{
		type:
			| "search-opened"
			| "search-closed"
			| "search-changed"
			| "search-results"
			| "search-moved"
			| "search-selected";
	}
>;

export function reduceSearch(state: AppState, action: SearchAction): AppState {
	switch (action.type) {
		case "search-opened":
			return {
				...state,
				focus: "conversations",
				search: { query: "", results: [], selectedIndex: 0, ran: false },
			};
		case "search-closed":
			return state.search === null ? state : { ...state, search: null };
		case "search-changed": {
			if (state.search === null) {
				return state;
			}
			return {
				...state,
				search: { query: action.query, results: [], selectedIndex: 0, ran: false },
			};
		}
		case "search-results": {
			if (state.search === null) {
				return state;
			}
			const last = Math.max(0, action.results.length - 1);
			return {
				...state,
				search: {
					...state.search,
					results: action.results,
					selectedIndex: Math.min(state.search.selectedIndex, last),
					ran: true,
				},
			};
		}
		case "search-moved": {
			if (state.search === null || state.search.results.length === 0) {
				return state;
			}
			const last = state.search.results.length - 1;
			const next = Math.min(last, Math.max(0, state.search.selectedIndex + action.delta));
			return next === state.search.selectedIndex
				? state
				: { ...state, search: { ...state.search, selectedIndex: next } };
		}
		case "search-selected": {
			const hit =
				state.search === null ? undefined : state.search.results[state.search.selectedIndex];
			if (hit === undefined) {
				return state;
			}
			// Jump by conversation, not by row: the hit's conversation is what the user picked,
			// and an index would go stale the moment the list reorders.
			const known = state.conversations.some((entry) => entry.id === hit.conversationId);
			return {
				...state,
				search: null,
				selectedId: known ? hit.conversationId : state.selectedId,
				scroll: 0,
				focus: "conversations",
			};
		}
		default:
			return state;
	}
}
