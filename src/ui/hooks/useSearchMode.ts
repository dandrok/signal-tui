import { useEffect } from "react";
import type { Action } from "../../app/state";
import type { MessageStore } from "../../ports/store";

/** Results shown at once; the pane truncates rather than pages. */
const SEARCH_LIMIT = 20;

const describe = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

/**
 * Search runs on every keystroke: the index is local, so a query is a millisecond.
 *
 * A cancelled run never dispatches — the answer to a query the user has already replaced
 * would show hits that belong to something else.
 */
export function useSearchMode(
	store: MessageStore,
	query: string | null,
	dispatch: (action: Action) => void,
): void {
	useEffect(() => {
		if (query === null) {
			return;
		}
		let cancelled = false;
		const run = async (): Promise<void> => {
			const results = query.trim().length === 0 ? [] : await store.search(query, SEARCH_LIMIT);
			if (!cancelled) {
				dispatch({ type: "search-results", results });
			}
		};
		void run().catch((error: unknown) => {
			if (!cancelled) {
				dispatch({
					type: "notice",
					notice: { kind: "info", text: `search failed: ${describe(error)}` },
				});
			}
		});
		return () => {
			cancelled = true;
		};
	}, [store, query, dispatch]);
}
