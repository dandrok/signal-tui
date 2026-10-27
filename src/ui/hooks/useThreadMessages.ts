import { useEffect } from "react";
import type { Action } from "../../app/state";
import type { ConversationId } from "../../domain/types";
import type { MessageStore } from "../../ports/store";

/** Messages per page: the first screenful, and every screenful of history behind it. */
export const MESSAGE_PAGE = 50;

const describe = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

/**
 * The newest page of the selected thread.
 *
 * Reloaded on every cache change, which is what makes an incoming message, an edit, a delete
 * or a receipt show up without a second subscription: the store is the truth, and this asks
 * it again.
 */
export function useThreadMessages(
	store: MessageStore,
	conversationId: ConversationId | undefined,
	version: number,
	dispatch: (action: Action) => void,
): void {
	// biome-ignore lint/correctness/useExhaustiveDependencies: `version` is a reload trigger, not a value read by the effect.
	useEffect(() => {
		if (conversationId === undefined) {
			return;
		}
		let cancelled = false;
		void store
			.listMessages(conversationId, MESSAGE_PAGE)
			.then((messages) => {
				if (!cancelled) {
					dispatch({ type: "messages-loaded", conversationId, messages });
				}
			})
			.catch((error: unknown) => {
				if (!cancelled) {
					dispatch({
						type: "notice",
						notice: { kind: "info", text: `cannot read messages: ${describe(error)}` },
					});
				}
			});
		return () => {
			cancelled = true;
		};
	}, [store, conversationId, version, dispatch]);
}
