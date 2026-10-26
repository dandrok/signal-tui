import type { Conversation, ConversationId, Message, MessageId } from "../domain/types";
import { selectedConversation, selectedIndex, selectedMessages } from "./conversations";
import {
	applyMessagesLoaded,
	applyOlderLoaded,
	invalidateHistory,
	releaseOlder,
	requestOlder,
} from "./history";

export * from "./conversations";

import type { ReplyTargetIn } from "./reply";
import { canAnswerIn, messageBeingAnsweredIn, pointedMessageIn, replyTargetIn } from "./reply";

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
	/**
	 * The message the draft answers, if any. An id rather than the message: the row it
	 * names can be edited or deleted while the reply is being written, and the pane must
	 * then show what actually happened to it.
	 */
	readonly replyToId: MessageId | null;
	/**
	 * True while the pane is waiting for the page above the oldest message it has. Set by
	 * the key that walks back, cleared by the load — one request at a time, so holding the
	 * key cannot queue a read per repeat.
	 */
	readonly olderRequested: boolean;
	/**
	 * Conversations whose history has been walked to the beginning. Absent means "there may
	 * be more": the pane cannot know until a page comes back short.
	 */
	readonly historyComplete: Readonly<Record<ConversationId, true>>;
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
	/** Asks for the page above the oldest loaded message. */
	| { readonly type: "older-requested" }
	/** The read failed: the pane must be able to ask again after a transient error. */
	| { readonly type: "older-failed" }
	/** A message older than the loaded history arrived: the thread may have more behind it. */
	| { readonly type: "history-invalidated"; readonly conversationId: ConversationId }
	| {
			readonly type: "older-loaded";
			readonly conversationId: ConversationId;
			readonly messages: readonly Message[];
			/** False when the store returned a short page: that was the beginning. */
			readonly hasMore: boolean;
	  }
	/** Answers the message the pane is pointing at; the reducer resolves which one. */
	| { readonly type: "reply-started" }
	| { readonly type: "reply-cancelled" }
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
	replyToId: null,
	olderRequested: false,
	historyComplete: {},
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
				// A reply belongs to the thread it was started in.
				replyToId: selectedId === state.selectedId ? state.replyToId : null,
				// So does a page request: leaving it pending would load history for whoever
				// is selected when the read lands, and shift a pane nobody asked to move.
				olderRequested: selectedId === state.selectedId ? state.olderRequested : false,
			};
		}
		case "messages-loaded":
			return applyMessagesLoaded(state, action);
		case "older-requested":
			return requestOlder(state);
		case "older-loaded":
			return applyOlderLoaded(state, action);
		case "older-failed":
			return releaseOlder(state);
		case "history-invalidated":
			return invalidateHistory(state, action.conversationId);
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
					{ ...state, selectedId: next.id, scroll: 0, replyToId: null, olderRequested: false };
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
			return {
				...state,
				draft: "",
				// The reply was sent with the text, so the next draft starts fresh.
				replyToId: null,
				notice: { kind: "queued", text: `queued: ${body}` },
			};
		}
		case "reply-started": {
			const target = pointedMessage(state);
			const conversation = selectedConversation(state);
			// Nothing to answer (an empty thread), or a row that is gone and cannot be
			// answered at all: either way there is no reply to start.
			if (
				target === undefined ||
				conversation === undefined ||
				!canAnswerIn(target, conversation.id)
			) {
				return state;
			}
			return { ...state, replyToId: target.id, focus: "composer" };
		}
		case "reply-cancelled":
			return state.replyToId === null && state.focus === "messages"
				? state
				: { ...state, replyToId: null, focus: "messages" };
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

/** State-shaped doors onto `./reply`, which takes messages and offsets instead. */
export function pointedMessage(state: AppState): Message | undefined {
	return pointedMessageIn(selectedMessages(state), state.scroll);
}

export function replyTarget(state: AppState): ReplyTargetIn | null {
	const conversation = selectedConversation(state);
	return conversation === undefined
		? null
		: replyTargetIn(selectedMessages(state), state.replyToId, conversation.id);
}

export function messageBeingAnswered(state: AppState): Message | undefined {
	return messageBeingAnsweredIn(selectedMessages(state), state.replyToId);
}
