import type { Conversation, ConversationId, Message } from "../domain/types";

export type Focus = "conversations" | "composer";

export interface AppState {
	readonly conversations: readonly Conversation[];
	readonly messagesByConversation: Readonly<Record<ConversationId, readonly Message[]>>;
	readonly selectedIndex: number;
	readonly focus: Focus;
	readonly draft: string;
	readonly notice: string | null;
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
	| { readonly type: "notice"; readonly notice: string | null };

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
		case "draft-changed":
			return state.draft === action.value ? state : { ...state, draft: action.value };
		case "draft-submitted": {
			const body = state.draft.trim();
			if (body.length === 0) {
				return state;
			}
			return { ...state, draft: "", notice: `queued: ${body}` };
		}
		case "notice":
			return state.notice === action.notice ? state : { ...state, notice: action.notice };
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
