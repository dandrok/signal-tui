import { canDelete } from "../usecases/delete";
import { canEdit } from "../usecases/edit";
import { forwardRefusal } from "../usecases/forward";
import { canReactTo } from "../usecases/react";
import type { PromptKind } from "./types";

/**
 * Why a prompt did not open.
 *
 * Split from the reducer when that file passed the cap, and along a line it already had: these are
 * the rules about *which message* a kind applies to, and nothing here changes state. The switch is
 * exhaustive on purpose — a seventh prompt kind has to come here and say what it applies to,
 * instead of inheriting whatever the previous one allowed.
 */

/** Why a prompt did not open, one line each. */
const REFUSALS = {
	reaction: "that message is gone: nothing to react to",
	edit: "only your own message can be edited",
	delete: "only your own message can be deleted for everyone",
} as const;

export function refusalFor(
	kind: PromptKind,
	message: Parameters<typeof canReactTo>[0],
	conversationId: string,
): string | null {
	switch (kind) {
		case "reaction":
			return canReactTo(message, conversationId) ? null : REFUSALS.reaction;
		case "edit":
			return canEdit(message, conversationId) ? null : REFUSALS.edit;
		case "delete":
			return canDelete(message, conversationId) ? null : REFUSALS.delete;
		case "forward":
			return forwardRefusal(message, conversationId);
		case "attach":
			return null;
		case "new":
			// Nothing to refuse: this prompt names no message and no thread — it is how you get a
			// thread at all, which is why `openPrompt` answers it before asking about either.
			return null;
		case "open":
			// Nothing to refuse here: whether a row's files may be launched is a question about the
			// filesystem and the engine's directory, and the wiring has already asked it before
			// dispatching this. The submit path asks again, because a row can be swept meanwhile.
			return null;
	}
}
