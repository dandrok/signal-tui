import type { Conversation, ConversationId, Message } from "../../domain/types";
import type { ReplyTargetIn } from "../reply";
import { replyTargetIn } from "../reply";
import type { AppState } from "./types";

/**
 * What the current state points at.
 *
 * The reducer decides what changes; these answer "which conversation, which messages, which
 * message is the keyboard pointing at" for the pane, the composer, the session wiring and the
 * tests. They take the whole state because that is the question they are asked — the reply
 * rules in `../reply.ts` take a thread and an offset instead, so the pane can ask the same
 * question about a window it holds without inventing a state.
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

export function selectedSearchResult(state: AppState): Message | undefined {
	return state.search?.results[state.search.selectedIndex];
}

/** The message the pane's scroll offset points at, resolved through `../reply`. */
export function pointedMessage(state: AppState): Message | undefined {
	const messages = selectedMessages(state);
	if (messages.length === 0) {
		return undefined;
	}
	const offset = Math.min(Math.max(0, state.scroll), messages.length - 1);
	return messages[messages.length - 1 - offset];
}

/** What a submitted draft would send as its reply, or null when it would not send one. */
export function replyTarget(state: AppState): ReplyTargetIn | null {
	const conversation = selectedConversation(state);
	return conversation === undefined
		? null
		: replyTargetIn(selectedMessages(state), state.replyToId, conversation.id);
}

/** The message a draft is answering, for the composer to draw. */
export function messageBeingAnswered(state: AppState): Message | undefined {
	if (state.replyToId === null) {
		return undefined;
	}
	return selectedMessages(state).find((message) => message.id === state.replyToId);
}
