import type { Conversation, ConversationId, Message } from "../domain/types";

export type Focus = "conversations" | "messages" | "composer";

/**
 * Tab order for the panes. Cycling reads this list rather than a chain of `if`s,
 * so a fourth pane is one array entry plus its own key handling.
 */
export const FOCUS_ORDER: readonly Focus[] = ["conversations", "messages", "composer"];

/** Notices are typed so a transient send confirmation is never confused with an error. */
export type NoticeKind = "queued" | "info";

export interface Notice {
	readonly kind: NoticeKind;
	readonly text: string;
}

/** Search is a mode, not a pane: while it is open the keyboard belongs to it. */
export interface SearchState {
	readonly query: string;
	readonly results: readonly Message[];
	readonly selectedIndex: number;
	/** True once a query has been run, so "no results" is distinguishable. */
	readonly ran: boolean;
}

export interface AppState {
	readonly conversations: readonly Conversation[];
	readonly messagesByConversation: Readonly<Record<ConversationId, readonly Message[]>>;
	readonly selectedIndex: number;
	readonly focus: Focus;
	/** Messages hidden above the window; `0` is pinned to the newest. */
	readonly scroll: number;
	readonly draft: string;
	readonly notice: Notice | null;
	readonly search: SearchState | null;
}

export type Action =
	| { readonly type: "conversations-loaded"; readonly conversations: readonly Conversation[] }
	| {
			readonly type: "messages-loaded";
			readonly conversationId: ConversationId;
			readonly messages: readonly Message[];
	  }
	| { readonly type: "move-selection"; readonly delta: number }
	| { readonly type: "focus"; readonly focus: Focus }
	| { readonly type: "focus-next" }
	| { readonly type: "focus-prev" }
	| { readonly type: "scroll-moved"; readonly delta: number }
	| { readonly type: "draft-changed"; readonly value: string }
	| { readonly type: "draft-submitted" }
	| { readonly type: "notice"; readonly notice: Notice | null }
	| { readonly type: "search-opened" }
	| { readonly type: "search-closed" }
	| { readonly type: "search-changed"; readonly query: string }
	| { readonly type: "search-results"; readonly results: readonly Message[] }
	| { readonly type: "search-moved"; readonly delta: number }
	| { readonly type: "search-selected" };

export const emptyState: AppState = {
	conversations: [],
	messagesByConversation: {},
	selectedIndex: 0,
	focus: "conversations",
	scroll: 0,
	draft: "",
	notice: null,
	search: null,
};

/** Pure reducer: every state transition is testable without a terminal. */
export function reduce(state: AppState, action: Action): AppState {
	switch (action.type) {
		case "conversations-loaded": {
			const lastIndex = Math.max(0, action.conversations.length - 1);
			const nextIndex = Math.min(state.selectedIndex, lastIndex);
			// A reload can reorder the list, so the same index may now be a different
			// conversation: keeping the old scroll offset would open it mid-history.
			const before = state.conversations[state.selectedIndex]?.id;
			const after = action.conversations[nextIndex]?.id;
			return {
				...state,
				conversations: action.conversations,
				selectedIndex: nextIndex,
				scroll: before === after ? state.scroll : 0,
			};
		}
		case "messages-loaded":
			return {
				...state,
				messagesByConversation: {
					...state.messagesByConversation,
					[action.conversationId]: action.messages,
				},
			};
		case "move-selection": {
			const lastIndex = Math.max(0, state.conversations.length - 1);
			const nextIndex = Math.min(lastIndex, Math.max(0, state.selectedIndex + action.delta));
			return nextIndex === state.selectedIndex
				? state
				: // A different conversation always starts at its newest message. The
					// other way round, the pane would open mid-history and look stale.
					{ ...state, selectedIndex: nextIndex, scroll: 0 };
		}
		case "focus":
			return state.focus === action.focus ? state : { ...state, focus: action.focus };
		case "focus-next":
		case "focus-prev": {
			const step = action.type === "focus-next" ? 1 : -1;
			const index = FOCUS_ORDER.indexOf(state.focus);
			const next =
				FOCUS_ORDER[(index + step + FOCUS_ORDER.length) % FOCUS_ORDER.length] ?? state.focus;
			return next === state.focus ? state : { ...state, focus: next };
		}
		case "scroll-moved": {
			// Clamped at 0 only: how many messages fit is a rendering fact, so the
			// upper bound is enforced where the window is built, not here.
			const next = Math.max(0, state.scroll + action.delta);
			return next === state.scroll ? state : { ...state, scroll: next };
		}
		case "draft-changed": {
			// Only the transient send confirmation is cleared; other notices survive typing.
			const nextNotice = state.notice?.kind === "queued" ? null : state.notice;
			return state.draft === action.value && state.notice === nextNotice
				? state
				: { ...state, draft: action.value, notice: nextNotice };
		}
		case "draft-submitted": {
			const body = state.draft.trim();
			if (body.length === 0) {
				return state;
			}
			return { ...state, draft: "", notice: { kind: "queued", text: `queued: ${body}` } };
		}
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
				// A new query invalidates the old results: showing them would suggest
				// they belong to what is being typed.
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
			const index = state.conversations.findIndex((entry) => entry.id === hit.conversationId);
			return {
				...state,
				search: null,
				selectedIndex: index === -1 ? state.selectedIndex : index,
				scroll: 0,
				focus: "conversations",
			};
		}
		case "notice": {
			const current = state.notice;
			const next = action.notice;
			const unchanged =
				current === next || (current?.kind === next?.kind && current?.text === next?.text);
			return unchanged ? state : { ...state, notice: next };
		}
		default:
			return state;
	}
}

export function selectedSearchResult(state: AppState): Message | undefined {
	return state.search?.results[state.search.selectedIndex];
}

export function selectedConversation(state: AppState): Conversation | undefined {
	return state.conversations[state.selectedIndex];
}

export function selectedMessages(state: AppState): readonly Message[] {
	const conversation = selectedConversation(state);
	if (!conversation) {
		return [];
	}
	return state.messagesByConversation[conversation.id] ?? [];
}
