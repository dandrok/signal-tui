import {
	applyMessagesLoaded,
	applyOlderLoaded,
	invalidateHistory,
	releaseOlder,
	requestOlder,
} from "./reduce-history";
import { cancelReaction, changeReaction, startReaction, submitReaction } from "./reduce-reaction";
import { cancelReply, startReply } from "./reduce-reply";
import { reduceSearch } from "./reduce-search";
import { reduceSelection } from "./reduce-selection";
import type { Action, AppState } from "./types";

/**
 * The reducer: one `switch` over the action vocabulary, delegating each subject to its own
 * file. It holds no rules of its own — a branch that grows logic here belongs in the module
 * that owns the subject.
 */
export function reduce(state: AppState, action: Action): AppState {
	switch (action.type) {
		case "conversations-loaded":
		case "move-selection":
		case "focus":
		case "focus-next":
		case "focus-prev":
		case "scroll-moved":
		case "draft-changed":
		case "draft-submitted":
		case "notice":
			return reduceSelection(state, action);
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
		case "reply-started":
			return startReply(state);
		case "reply-cancelled":
			return cancelReply(state);
		case "reaction-started":
			return startReaction(state);
		case "reaction-changed":
			return changeReaction(state, action.value);
		case "reaction-cancelled":
			return cancelReaction(state);
		case "reaction-submitted":
			return submitReaction(state);
		case "search-opened":
		case "search-closed":
		case "search-changed":
		case "search-results":
		case "search-moved":
		case "search-selected":
			return reduceSearch(state, action);
		default:
			return state;
	}
}
