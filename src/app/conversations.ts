import type { Conversation, ConversationId, Message } from "../domain/types";
import type { AppState } from "./state";

/**
 * Which conversation is selected, and which messages belong to it.
 *
 * Split out of `state.ts` by responsibility: the reducer decides what changes, and these
 * answer "what does the current state point at" for the pane, the composer and the tests.
 * `AppState` is imported as a type only, so the module graph stays one-directional at runtime.
 */

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
