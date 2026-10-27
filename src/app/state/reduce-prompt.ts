import { canDelete } from "../usecases/delete";
import { canEdit } from "../usecases/edit";
import { canReactTo } from "../usecases/react";
import { pointedMessage, selectedConversation } from "./selectors";
import type { AppState, PromptKind } from "./types";

/**
 * The prompt: reaction, edit, delete-for-everyone.
 *
 * Nothing is sent here. The reducer decides that a prompt exists, what it points at and what
 * has been typed; the wiring resolves the target again before the send, so a row that was
 * deleted while the prompt was open is refused by the same predicate the key used.
 */

/**
 * Whether a message can take this prompt, decided by the use case that owns the rule.
 *
 * The switch is exhaustive on purpose: a fourth prompt kind has to come here and say what it
 * applies to, instead of inheriting whatever the previous one allowed.
 */
function allows(
	kind: PromptKind,
	message: Parameters<typeof canReactTo>[0],
	conversationId: string,
): boolean {
	switch (kind) {
		case "reaction":
			return canReactTo(message, conversationId);
		case "edit":
			return canEdit(message, conversationId);
		case "delete":
			return canDelete(message, conversationId);
	}
}

/** Why a prompt did not open, one line each. */
const refusals = {
	reaction: "that message is gone: nothing to react to",
	edit: "only your own message can be edited",
	delete: "only your own message can be deleted for everyone",
} as const;

/**
 * Opens a prompt on the message the pane points at.
 *
 * An edit starts from the body it would replace — pressing `e` and typing should change the
 * text, not retype it — while a reaction starts empty and a delete carries nothing.
 */
export function openPrompt(state: AppState, kind: PromptKind): AppState {
	const target = pointedMessage(state);
	const conversation = selectedConversation(state);
	if (target === undefined || conversation === undefined) {
		return state;
	}
	if (!allows(kind, target, conversation.id)) {
		// A prompt that does not open has to say so: the key was pressed on a message the
		// status line had just stopped advertising, and silence reads as a broken key.
		return {
			...state,
			notice: { kind: "info", text: refusals[kind] },
		};
	}
	return {
		...state,
		prompt: { kind, targetId: target.id, draft: kind === "edit" ? target.body : "" },
	};
}

export function changePrompt(state: AppState, value: string): AppState {
	const prompt = state.prompt;
	if (prompt === null || prompt.draft === value) {
		return state;
	}
	return { ...state, prompt: { ...prompt, draft: value } };
}

export function cancelPrompt(state: AppState): AppState {
	return state.prompt === null ? state : { ...state, prompt: null };
}

/**
 * Closing the prompt is all the reducer does: the send is a side effect, and only the wiring
 * knows the session. A prompt whose draft turned out to be unusable is closed the same way,
 * with a notice from the wiring.
 */
export function submitPrompt(state: AppState): AppState {
	return state.prompt === null ? state : { ...state, prompt: null };
}
