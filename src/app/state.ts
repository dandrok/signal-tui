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
	/**
	 * Which conversation is selected, by id rather than by its row in the list.
	 *
	 * The list is ordered by activity, so it reorders whenever a message arrives or is
	 * sent: an index would then point at whoever moved into that row, and the message
	 * pane would silently switch to a different person. The selection is about a
	 * conversation, so it has to survive the list moving.
	 */
	readonly selectedId: ConversationId | null;
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
	selectedId: null,
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
			// A reload can reorder the list — that is the point of ordering it by
			// activity. The selection is an id, so the same person stays selected no
			// matter which row they moved to; only a conversation that left the list
			// entirely moves the cursor, and then to the top of the list.
			const stillThere = action.conversations.some((entry) => entry.id === state.selectedId);
			const selectedId = stillThere ? state.selectedId : (action.conversations[0]?.id ?? null);
			return {
				...state,
				conversations: action.conversations,
				selectedId,
				// Only a different conversation starts at its newest message. A reorder
				// keeps the offset because it is still the same thread.
				scroll: selectedId === state.selectedId ? state.scroll : 0,
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
			const current = selectedIndex(state);
			if (current === -1) {
				return state;
			}
			const lastIndex = Math.max(0, state.conversations.length - 1);
			const nextIndex = Math.min(lastIndex, Math.max(0, current + action.delta));
			const next = state.conversations[nextIndex];
			return next === undefined || nextIndex === current
				? state
				: // A different conversation always starts at its newest message. The
					// other way round, the pane would open mid-history and look stale.
					{ ...state, selectedId: next.id, scroll: 0 };
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
			// How many messages fit is a rendering fact, but the oldest message is not:
			// without this bound a held key keeps counting up, and every press back
			// then lands on that dead range instead of moving the pane.
			const id = selectedConversation(state)?.id;
			const available = id === undefined ? 0 : (state.messagesByConversation[id]?.length ?? 0);
			const furthest = Math.max(0, available - 1);
			const next = Math.min(Math.max(0, state.scroll + action.delta), furthest);
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
			// Jump by conversation, not by row: the hit's conversation is what the user
			// picked, and an index would go stale the moment the list reorders.
			const known = state.conversations.some((entry) => entry.id === hit.conversationId);
			return {
				...state,
				search: null,
				selectedId: known ? hit.conversationId : state.selectedId,
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
	return state.conversations.find((entry) => entry.id === state.selectedId);
}

/**
 * Row of the selected conversation, or -1 when nothing is selected. A render fact
 * derived on demand: storing the row is what made the pane follow the row instead
 * of the conversation.
 */
export function selectedIndex(state: AppState): number {
	return state.conversations.findIndex((entry) => entry.id === state.selectedId);
}

/**
 * Id → row for one conversation list, for callers that resolve the selection on every
 * frame. Kept here as a pure function so what a row *is* stays in one place; the UI
 * decides when to rebuild it (memoized on the list, not on each keystroke), which is
 * what keeps a redraw from rescanning the whole list.
 */
export function conversationRows(
	conversations: readonly Conversation[],
): ReadonlyMap<ConversationId, number> {
	return new Map(conversations.map((entry, position) => [entry.id, position] as const));
}

export function selectedMessages(state: AppState): readonly Message[] {
	const conversation = selectedConversation(state);
	if (!conversation) {
		return [];
	}
	return state.messagesByConversation[conversation.id] ?? [];
}
