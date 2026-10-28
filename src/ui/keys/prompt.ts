import type { AppState } from "../../app/state";
import { action, type KeyLike, type KeyResult } from "./types";

/**
 * The open prompt, whatever it is asking.
 *
 * A delete is confirmed rather than typed: `⏎` or `y` sends it, anything else leaves it alone,
 * so a keystroke meant for the pane cannot remove a message from everyone else's phone. The
 * other three are text fields, and they share one rule — type, backspace, `⏎` to send. The
 * reaction and forward prompts also have a list, which tab and the arrows walk.
 */
export function promptKey(state: AppState, input: string, key: KeyLike): KeyResult {
	const prompt = state.prompt;
	if (prompt === null) {
		return null;
	}
	if (key.escape === true) {
		return action({ type: "prompt-cancelled" });
	}
	if (prompt.kind === "reaction" || prompt.kind === "forward" || prompt.kind === "attach") {
		// Three pickers, one rule: tab and the arrows walk the suggestions, and every other key
		// is text the draft is being narrowed with — an emoji name, a chat's, a path's.
		if (key.tab === true) {
			return action({ type: "prompt-moved", delta: key.shift === true ? -1 : 1 });
		}
		if (key.upArrow === true) {
			return action({ type: "prompt-moved", delta: -1 });
		}
		if (key.downArrow === true) {
			return action({ type: "prompt-moved", delta: 1 });
		}
	}
	if (prompt.kind === "delete") {
		if (key.return === true || input === "y") {
			return action({ type: "prompt-submitted" });
		}
		return input === "n" ? action({ type: "prompt-cancelled" }) : null;
	}
	if (prompt.kind === "attach" && key.return === true) {
		// A directory is a step, not a message: `⏎` on one descends into it, and the next `⏎`
		// on a file sends. That is what makes the listing usable without a second key. Every
		// other key stays a keystroke in the path.
		const picked = prompt.paths?.[prompt.pick];
		return action(
			picked?.isDirectory === true
				? { type: "prompt-changed", value: `${picked.path}/` }
				: { type: "prompt-submitted" },
		);
	}
	if (key.return === true) {
		return action({ type: "prompt-submitted" });
	}
	if (key.backspace === true || key.delete === true) {
		return action({ type: "prompt-changed", value: prompt.draft.slice(0, -1) });
	}
	return input.length > 0 ? action({ type: "prompt-changed", value: prompt.draft + input }) : null;
}
