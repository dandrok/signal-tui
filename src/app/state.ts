import type { Conversation, ConversationId, Message } from "../domain/types";

export type Focus = "conversations" | "composer";

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
	draft: "",
	notice: null,
	search: null,
};

/** Pure reducer: every state transition is testable without a terminal. */
export function reduce(state: AppState, action: Action): AppState {
	switch (action.type) {
		case "conversations-loaded": {
			const lastIndex = Math.max(0, action.conversations.length - 1);
			return {
				...state,
				conversations: action.conversations,
				selectedIndex: Math.min(state.selectedIndex, lastIndex),
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
			return nextIndex === state.selectedIndex ? state : { ...state, selectedIndex: nextIndex };
		}
		case "focus":
			return state.focus === action.focus ? state : { ...state, focus: action.focus };
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
