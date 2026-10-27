import { useEffect } from "react";
import type { Action } from "../../app/state";
import type { MessageStore } from "../../ports/store";

const describe = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

/**
 * The conversation list, reloaded whenever the cache changed.
 *
 * `version` is a reload trigger rather than a value this reads, which is why the dependency
 * array carries it explicitly while the body only reads the store.
 */
export function useConversations(
	store: MessageStore,
	version: number,
	dispatch: (action: Action) => void,
): void {
	// biome-ignore lint/correctness/useExhaustiveDependencies: `version` is a reload trigger, not a value read by the effect.
	useEffect(() => {
		let cancelled = false;
		void store
			.listConversations()
			.then((conversations) => {
				if (!cancelled) {
					dispatch({ type: "conversations-loaded", conversations });
				}
			})
			.catch((error: unknown) => {
				if (!cancelled) {
					dispatch({
						type: "notice",
						notice: { kind: "info", text: `cannot read conversations: ${describe(error)}` },
					});
				}
			});
		return () => {
			cancelled = true;
		};
	}, [store, version, dispatch]);
}
