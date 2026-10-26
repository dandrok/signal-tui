import { useCallback, useEffect, useRef, useState } from "react";
import { incomingSequence, title, unreadTitle, type Writer } from "../app/notify";
import type { Session } from "../app/session";
import type { Action, AppState } from "../app/state";
import { emptyState, reduce, replyTarget, selectedConversation } from "../app/state";
import type { MessageStore } from "../ports/store";
import { App } from "./App";

export interface RootProps {
	readonly store: MessageStore;
	/** Absent in demo mode: there is nothing to send to and nothing to listen for. */
	readonly session?: Session | undefined;
	/** Where notification sequences go. Injectable so tests can collect them. */
	readonly write?: Writer | undefined;
}

/** Nothing is written unless a person is looking at a terminal: piped output stays clean. */
const stdoutWriter: Writer = (chunk) => {
	if (process.stdout.isTTY === true) {
		process.stdout.write(chunk);
	}
};

const describe = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

/** Results shown at once; the pane truncates rather than pages. */
const SEARCH_LIMIT = 20;

/**
 * Owns app state and the two side effects it needs: a send when a draft is
 * submitted, and a reload when the session says the cache changed.
 */
export function Root({ store, session, write = stdoutWriter }: RootProps) {
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
				// Resolved before the reducer clears it: the target is what makes this a
				// reply rather than a message, and only the state knows which row it names.
				const replyTo = replyTarget(stateRef.current);
				if (body.length > 0 && conversation !== undefined) {
					void session.send(conversation.id, body, replyTo ?? undefined).catch((error: unknown) => {
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

	// A message nobody is looking at is the whole reason a notification exists: the thread
	// on screen needs none, and the session only announces rows it actually stored.
	useEffect(() => {
		if (session === undefined) {
			return;
		}
		return session.onIncoming((notice) => {
			if (notice.message.conversationId === stateRef.current.selectedId) {
				return;
			}
			write(incomingSequence(notice));
		});
	}, [session, write]);

	// The title carries what the sidebar would say, for when the window is behind something.
	useEffect(() => {
		const unread = state.conversations.reduce((total, entry) => total + entry.unreadCount, 0);
		write(title(unreadTitle(unread)));
	}, [state.conversations, write]);

	const conversationId = selectedConversation(state)?.id;
	const searchQuery = state.search?.query ?? null;

	// Search runs on every keystroke: the index is local, so a query is a millisecond.
	useEffect(() => {
		if (searchQuery === null) {
			return;
		}
		let cancelled = false;
		const run = async (): Promise<void> => {
			const results =
				searchQuery.trim().length === 0 ? [] : await store.search(searchQuery, SEARCH_LIMIT);
			if (!cancelled) {
				setState((current) =>
					current.search === null ? current : reduce(current, { type: "search-results", results }),
				);
			}
		};
		void run().catch((error: unknown) => {
			if (!cancelled) {
				setState((current) =>
					reduce(current, {
						type: "notice",
						notice: { kind: "info", text: `search failed: ${describe(error)}` },
					}),
				);
			}
		});
		return () => {
			cancelled = true;
		};
	}, [store, searchQuery]);

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

	// The conversation on screen is read: clear its badge on open, and keep it
	// clear while messages arrive (`version` changes on every update).
	// biome-ignore lint/correctness/useExhaustiveDependencies: `version` triggers the re-run, it is not read here.
	useEffect(() => {
		if (conversationId === undefined || session === undefined) {
			return;
		}
		void session.markRead(conversationId);
	}, [session, conversationId, version]);

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
