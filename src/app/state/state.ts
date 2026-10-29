import {
	applyMessagesLoaded,
	applyOlderLoaded,
	invalidateHistory,
	releaseOlder,
	requestOlder,
} from "./reduce-history";
import {
	allowFiles,
	cancelPrompt,
	changePrompt,
	movePrompt,
	openPrompt,
	submitPrompt,
} from "./reduce-prompt";
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
		case "composer-cleared":
		case "composer-restored":
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
		case "prompt-opened":
			return openPrompt(state, action.kind, action.paths, action.files);
		case "prompt-changed":
			return changePrompt(state, action.value, action.paths);
		case "prompt-moved":
			return movePrompt(state, action.delta);
		case "prompt-cancelled":
			return cancelPrompt(state);
		case "prompt-submitted":
			return submitPrompt(state);
		case "hide-requested":
			// A side effect, not a transition: the wiring reads the pointed message and
			// writes the flag, so there is nothing for the reducer to change.
			return state;
		case "open-requested":
			// The same: the verdict belongs to `usecases/open`, and the wiring has it. What this
			// action owes the state is a prompt or nothing at all.
			return state;
		case "files-may-open":
			return allowFiles(state);
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
