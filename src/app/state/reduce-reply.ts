import { canAnswerIn } from "../reply";
import { pointedMessage, selectedConversation } from "./selectors";
import type { AppState } from "./types";

/**
 * A reply is a mode holding a target, and the target is an id.
 *
 * Eligibility is checked here, where the target is written — the reducer is its only writer —
 * with the same predicate the send path uses. A row that is still in the thread can stop being
 * answerable (a delete-for-everyone and a timer both keep the row and blank its text), and two
 * copies of that rule would let the composer draw a quote the send path refuses.
 */
export function startReply(state: AppState): AppState {
	const target = pointedMessage(state);
	const conversation = selectedConversation(state);
	// Nothing to answer (an empty thread), or a row that is gone and cannot be answered at
	// all: either way there is no reply to start.
	if (target === undefined || conversation === undefined || !canAnswerIn(target, conversation.id)) {
		return state;
	}
	return { ...state, replyToId: target.id, focus: "composer" };
}

export function cancelReply(state: AppState): AppState {
	return state.replyToId === null && state.focus === "messages"
		? state
		: { ...state, replyToId: null, focus: "messages" };
}
