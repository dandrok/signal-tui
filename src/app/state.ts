import type { Conversation, ConversationId, Message } from "../domain/types";

export type Focus = "conversations" | "composer";

/** Notices are typed so a transient send confirmation is never confused with an error. */
export type NoticeKind = "queued" | "info";

export interface Notice {
	readonly kind: NoticeKind;
	readonly text: string;
}

export interface AppState {
	readonly conversations: readonly Conversation[];
	readonly messagesByConversation: Readonly<Record<ConversationId, readonly Message[]>>;
	readonly selectedIndex: number;
	readonly focus: Focus;
	readonly draft: string;
	readonly notice: Notice | null;
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
	| { readonly type: "notice"; readonly notice: Notice | null };

export const emptyState: AppState = {
	conversations: [],
	messagesByConversation: {},
	selectedIndex: 0,
	focus: "conversations",
	draft: "",
	notice: null,
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
