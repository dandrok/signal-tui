import type { AppState } from "../../app/state";
import { action, type KeyLike, type KeyResult, SCROLL_STEP } from "./types";

/**
 * The conversation list and the message pane, which share most of their keys.
 *
 * `j`/`k` are the one pair whose meaning depends on the pane: moving the selection in the
 * list, scrolling in the thread. `k` at the top of what is loaded asks for the page above
 * instead of scrolling into nothing, so history past the first page is reachable at all.
 *
 * The message actions each open a prompt or ask for one write; none of them sends anything
 * directly, because the wiring knows the session and the reducer does not.
 */
export function paneKey(state: AppState, input: string, key: KeyLike): KeyResult {
	if (input === "q") {
		return { kind: "exit" };
	}
	if (input === "/") {
		return action({ type: "search-opened" });
	}
	if (input === "i" || key.return === true) {
		return action({ type: "focus", focus: "composer" });
	}

	const inMessages = state.focus === "messages";
	if (inMessages && input === "r") {
		return action({ type: "reply-started" });
	}
	if (inMessages && input === "x") {
		return action({ type: "prompt-opened", kind: "reaction" });
	}
	if (inMessages && input === "e") {
		return action({ type: "prompt-opened", kind: "edit" });
	}
	if (inMessages && input === "d") {
		return action({ type: "prompt-opened", kind: "delete" });
	}
	if (inMessages && input === "f") {
		return action({ type: "prompt-opened", kind: "forward" });
	}
	// A file goes to the conversation, not to the message under the pointer, so `a` works from
	// both panes that have a conversation selected.
	if (input === "a") {
		return action({ type: "prompt-opened", kind: "attach" });
	}
	if (inMessages && input === "D") {
		return action({ type: "hide-requested" });
	}
	// `o` opens the file on the pointed row. The verdict — whether that file may be launched at
	// all — is the wiring's, because it needs the filesystem; the key only says which row.
	if (inMessages && input === "o") {
		return action({ type: "open-requested" });
	}
	if (inMessages && key.pageUp === true) {
		return action({ type: "scroll-moved", delta: SCROLL_STEP });
	}
	if (inMessages && key.pageDown === true) {
		return action({ type: "scroll-moved", delta: -SCROLL_STEP });
	}
	if (input === "j") {
		return action(
			inMessages ? { type: "scroll-moved", delta: -1 } : { type: "move-selection", delta: 1 },
		);
	}
	if (input === "k") {
		if (!inMessages) {
			return action({ type: "move-selection", delta: -1 });
		}
		// At the top of what is loaded there is nothing left to scroll to: ask for the page
		// above it instead.
		const loaded = state.messagesByConversation[state.selectedId ?? ""]?.length ?? 0;
		return state.scroll >= loaded - 1
			? action({ type: "older-requested" })
			: action({ type: "scroll-moved", delta: 1 });
	}
	return null;
}
