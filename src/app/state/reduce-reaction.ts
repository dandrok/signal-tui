import { canReactTo } from "../usecases/react";
import { pointedMessage, selectedConversation } from "./selectors";
import type { AppState } from "./types";

/**
 * The emoji prompt: a mode holding an id, opened from the message the pane points at.
 *
 * Nothing is sent here. The reducer decides that a prompt exists and what is typed into it;
 * the wiring in `ui/Root.tsx` resolves the target again before the send, so a row that was
 * deleted while the emoji was being typed is refused by the same predicate the key used.
 */

export function startReaction(state: AppState): AppState {
	const target = pointedMessage(state);
	const conversation = selectedConversation(state);
	// Nothing to react to, or a row that cannot take a reaction: no prompt at all, rather
	// than one whose result the store would drop.
	if (target === undefined || conversation === undefined) {
		return state;
	}
	if (!canReactTo(target, conversation.id)) {
		return state;
	}
	return { ...state, reaction: { targetId: target.id, draft: "" } };
}

export function changeReaction(state: AppState, value: string): AppState {
	const prompt = state.reaction;
	if (prompt === null || prompt.draft === value) {
		return state;
	}
	return { ...state, reaction: { ...prompt, draft: value } };
}

export function cancelReaction(state: AppState): AppState {
	return state.reaction === null ? state : { ...state, reaction: null };
}

/**
 * Closing the prompt is all the reducer does: the send is a side effect, and only the
 * wiring knows the session. A prompt whose emoji turned out to be invalid is closed the
 * same way, with a notice from the wiring.
 */
export function submitReaction(state: AppState): AppState {
	return state.reaction === null ? state : { ...state, reaction: null };
}
