import type { AttachCandidate } from "../usecases/attach";
import { canDelete } from "../usecases/delete";
import { canEdit } from "../usecases/edit";
import { forwardMatches, forwardRefusal, forwardTargets } from "../usecases/forward";
import { canReactTo, reactionSuggestions } from "../usecases/react";
import { pointedMessage, selectedConversation } from "./selectors";
import type { AppState, PromptKind, PromptState } from "./types";

/**
 * The prompt: reaction, edit, delete-for-everyone, forward, attach.
 *
 * Nothing is sent here. The reducer decides that a prompt exists, what it points at and what
 * has been typed; the wiring resolves the target again before the send, so a row that was
 * deleted while the prompt was open is refused by the same predicate the key used.
 */

/** Why a prompt did not open, one line each. */
const REFUSALS = {
	reaction: "that message is gone: nothing to react to",
	edit: "only your own message can be edited",
	delete: "only your own message can be deleted for everyone",
} as const;

/**
 * Why a message cannot take this prompt, or null when it can.
 *
 * The switch is exhaustive on purpose: a sixth prompt kind has to come here and say what it
 * applies to, instead of inheriting whatever the previous one allowed. Reaction, edit and
 * delete refuse with one fixed sentence; a forward has several different reasons and its use
 * case owns their wording. An attach prompt is about no message at all.
 */
function refusalFor(
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
	}
}

/**
 * Opens a prompt.
 *
 * An edit starts from the body it would replace — pressing `e` and typing should change the
 * text, not retype it — while a reaction and a forward start empty: the first because there is
 * nothing to prefill, the second because an empty filter is every conversation.
 *
 * An attach prompt is the one that names no row: a file goes to the conversation, so it opens
 * with the listing the caller already read (`paths`) and no target.
 */
export function openPrompt(
	state: AppState,
	kind: PromptKind,
	paths?: readonly AttachCandidate[],
): AppState {
	const conversation = selectedConversation(state);
	if (conversation === undefined) {
		return state;
	}
	if (kind === "attach") {
		return {
			...state,
			prompt: {
				kind,
				targetId: null,
				draft: "",
				pick: 0,
				...(paths === undefined ? {} : { paths }),
			},
		};
	}

	const target = pointedMessage(state);
	if (target === undefined) {
		return state;
	}
	const refusal = refusalFor(kind, target, conversation.id);
	if (refusal !== null) {
		// A prompt that does not open has to say so: the key was pressed on a message the
		// status line had just stopped advertising, and silence reads as a broken key.
		return { ...state, notice: { kind: "info", text: refusal } };
	}
	return {
		...state,
		// An edit starts from the body it replaces; a reaction starts with the picker on its
		// best suggestion, so `x` then `⏎` is a complete action. A forward freezes the list it
		// offers, so the row that is highlighted now is the row the confirm sends to.
		prompt: {
			kind,
			targetId: target.id,
			draft: kind === "edit" ? target.body : "",
			pick: 0,
			...(kind === "forward"
				? { chats: forwardTargets(state.conversations, conversation.id) }
				: {}),
		},
	};
}

export function changePrompt(
	state: AppState,
	value: string,
	paths?: readonly AttachCandidate[],
): AppState {
	const prompt = state.prompt;
	if (prompt === null) {
		return state;
	}
	if (prompt.draft === value && (paths === undefined || paths === prompt.paths)) {
		return state;
	}
	// Typing re-ranks the suggestions, so the highlight goes back to the best match: leaving it
	// where it was would keep a position that now means a different emoji, chat or file.
	return {
		...state,
		prompt: { ...prompt, draft: value, pick: 0, ...(paths === undefined ? {} : { paths }) },
	};
}

/**
 * What the arrow keys can walk in the open prompt, or 0 when the prompt has no list.
 *
 * The reaction prompt's list is emoji; the forward prompt's is the conversations it froze when
 * it opened; the attach prompt's is the directory listing the keystroke brought with it.
 * Reading the count from the same value the pane draws with is what keeps a highlight from
 * pointing past the end of a filter that just shrank.
 */
function pickableCount(prompt: PromptState): number {
	switch (prompt.kind) {
		case "reaction":
			return reactionSuggestions(prompt.draft, prompt.pick).emoji.length;
		case "forward":
			return forwardMatches(prompt.chats ?? [], prompt.draft, prompt.pick).matches.length;
		case "attach":
			return prompt.paths?.length ?? 0;
		default:
			return 0;
	}
}

/** Arrow keys and tab walk the suggestions; a text field with no list ignores them. */
export function movePrompt(state: AppState, delta: number): AppState {
	const prompt = state.prompt;
	if (prompt === null) {
		return state;
	}
	const count = pickableCount(prompt);
	if (count === 0) {
		return state;
	}
	// Wrapping, because a five-item list is shorter than anyone's patience for clamping.
	const pick = (prompt.pick + delta + count) % count;
	return { ...state, prompt: { ...prompt, pick } };
}

export function cancelPrompt(state: AppState): AppState {
	return state.prompt === null ? state : { ...state, prompt: null };
}

/**
 * Closing the prompt is all the reducer does: the send is a side effect, and only the wiring
 * knows the session. A prompt whose draft turned out to be unusable is closed the same way,
 * with a notice from the wiring — and a directory in an attach prompt never reaches here,
 * because the keymap descends into it instead.
 */
export function submitPrompt(state: AppState): AppState {
	return state.prompt === null ? state : { ...state, prompt: null };
}
