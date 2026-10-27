/**
 * App state: the vocabulary, the empty state, the reducer and what it points at.
 *
 * One subject per file — `selectors` answers questions about the current state, `reduce-*`
 * answers what an action does to it, `empty` is where it starts — and this file is the only
 * entry point. Nothing here imports an adapter, a component or the session: the state is a
 * value, and the wiring lives in `ui/Root.tsx`.
 */

export { emptyState, FOCUS_ORDER } from "./empty";
export {
	conversationRows,
	messageBeingAnswered,
	pointedMessage,
	replyTarget,
	selectedConversation,
	selectedIndex,
	selectedMessages,
	selectedSearchResult,
} from "./selectors";
export { reduce } from "./state";
export type { Action, AppState, Focus, Notice, NoticeKind, SearchState } from "./types";
