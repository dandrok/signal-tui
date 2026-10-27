import { useEffect } from "react";
import type { Action } from "../../app/state";
import type { ConversationId } from "../../domain/types";
import type { MessageStore } from "../../ports/store";
import { MESSAGE_PAGE } from "./useThreadMessages";

const describe = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

/**
 * The page above the oldest loaded message, one request at a time.
 *
 * The reducer clears `olderRequested` as it applies the page, so a held key cannot queue a
 * read per repeat — the next request only arrives after this one landed. A failure releases
 * the request without marking the thread complete, or one transient error would make `k` a
 * no-op for the rest of the session.
 */
export function useOlderPage(
	store: MessageStore,
	olderRequested: boolean,
	conversationId: ConversationId | undefined,
	oldestSentAt: number | undefined,
	dispatch: (action: Action) => void,
): void {
	useEffect(() => {
		if (!olderRequested || conversationId === undefined) {
			return;
		}
		let cancelled = false;
		void store
			.listMessagesBefore(conversationId, oldestSentAt ?? Number.MAX_SAFE_INTEGER, MESSAGE_PAGE)
			.then((messages) => {
				if (!cancelled) {
					dispatch({
						type: "older-loaded",
						conversationId,
						messages,
						hasMore: messages.length === MESSAGE_PAGE,
					});
				}
			})
			.catch((error: unknown) => {
				if (cancelled) {
					return;
				}
				dispatch({ type: "older-failed" });
				dispatch({
					type: "notice",
					notice: { kind: "info", text: `cannot read older messages: ${describe(error)}` },
				});
			});
		return () => {
			cancelled = true;
		};
	}, [olderRequested, conversationId, oldestSentAt, store, dispatch]);
}
