import type { AppState } from "./types";

/** Tab order for the panes, so a fourth pane is one array entry plus its own key handling. */
export const FOCUS_ORDER: readonly AppState["focus"][] = ["conversations", "messages", "composer"];

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
	reaction: null,
};
