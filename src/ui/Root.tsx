import { useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "../app/session";
import type { Action, AppState } from "../app/state";
import { emptyState, reduce, selectedConversation } from "../app/state";
import type { MessageStore } from "../ports/store";
import { App } from "./App";

export interface RootProps {
	readonly store: MessageStore;
	/** Absent in demo mode: there is nothing to send to and nothing to listen for. */
	readonly session?: Session | undefined;
}

const describe = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

/**
 * Owns app state and the two side effects it needs: a send when a draft is
 * submitted, and a reload when the session says the cache changed.
 */
export function Root({ store, session }: RootProps) {
	const [state, setState] = useState<AppState>(emptyState);
	const [version, setVersion] = useState(0);
	const stateRef = useRef(state);

	useEffect(() => {
		stateRef.current = state;
	}, [state]);

	const dispatch = useCallback(
		(action: Action): void => {
			if (action.type === "draft-submitted" && session !== undefined) {
				const body = stateRef.current.draft.trim();
				const conversation = selectedConversation(stateRef.current);
				if (body.length > 0 && conversation !== undefined) {
					void session.send(conversation.id, body).catch((error: unknown) => {
						setState((current) =>
							reduce(current, {
								type: "notice",
								notice: { kind: "info", text: `send failed: ${describe(error)}` },
							}),
						);
					});
				}
			}
			setState((current) => reduce(current, action));
		},
		[session],
	);

	useEffect(() => {
		if (session === undefined) {
			return;
		}
		return session.onChange(() => setVersion((current) => current + 1));
	}, [session]);

	const conversationId = selectedConversation(state)?.id;

	// biome-ignore lint/correctness/useExhaustiveDependencies: `version` is a reload trigger, not a value read by the effect.
	useEffect(() => {
		let cancelled = false;
		void store
			.listConversations()
			.then((conversations) => {
				if (cancelled) {
					return;
				}
				setState((current) => reduce(current, { type: "conversations-loaded", conversations }));
			})
			.catch((error: unknown) => {
				if (cancelled) {
					return;
				}
				setState((current) =>
					reduce(current, {
						type: "notice",
						notice: { kind: "info", text: `cannot read conversations: ${describe(error)}` },
					}),
				);
			});
		return () => {
			cancelled = true;
		};
	}, [store, version]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: `version` is a reload trigger, not a value read by the effect.
	useEffect(() => {
		if (conversationId === undefined) {
			return;
		}
		let cancelled = false;
		void store
			.listMessages(conversationId)
			.then((messages) => {
				if (cancelled) {
					return;
				}
				setState((current) =>
					reduce(current, { type: "messages-loaded", conversationId, messages }),
				);
			})
			.catch((error: unknown) => {
				if (cancelled) {
					return;
				}
				setState((current) =>
					reduce(current, {
						type: "notice",
						notice: { kind: "info", text: `cannot read messages: ${describe(error)}` },
					}),
				);
			});
		return () => {
			cancelled = true;
		};
	}, [store, conversationId, version]);

	return <App state={state} dispatch={dispatch} />;
}
