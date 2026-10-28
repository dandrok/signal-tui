import type { AppState } from "../../app/state";
import { action, type KeyLike, type KeyResult } from "./types";

/**
 * The composer: every printable key is the draft, `⏎` sends it, and escape steps back out of
 * the box — or drops a reply target first, because a reply is a mode and leaving it while the
 * composer still claims to answer something would send the next draft as a reply to nothing.
 */
export function composerKey(state: AppState, input: string, key: KeyLike): KeyResult {
	if (key.return === true) {
		return action({ type: "draft-submitted" });
	}
	if (key.escape === true) {
		return action(
			state.replyToId === null ? { type: "focus", focus: "messages" } : { type: "reply-cancelled" },
		);
	}
	if (key.backspace === true || key.delete === true) {
		return action({ type: "draft-changed", value: state.draft.slice(0, -1) });
	}
	return action({ type: "draft-changed", value: state.draft + input });
}
