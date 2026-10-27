import { FOCUS_ORDER } from "./empty";
import { selectedConversation, selectedIndex } from "./selectors";
import type { Action, AppState } from "./types";

/**
 * Transitions about *which* conversation is selected, where the keyboard is, how far the pane
 * is scrolled, and what the composer holds. They are one subject: nothing here reads a
 * message's content, so none of them needs the reply, history or search rules.
 */

type SelectionAction = Extract<
	Action,
	{
		type:
			| "conversations-loaded"
			| "move-selection"
			| "focus"
			| "focus-next"
			| "focus-prev"
			| "scroll-moved"
			| "draft-changed"
			| "draft-submitted"
			| "notice";
	}
>;

export function reduceSelection(state: AppState, action: SelectionAction): AppState {
	switch (action.type) {
		case "conversations-loaded": {
			// A reload can reorder the list — that is the point of ordering it by activity.
			// The selection is an id, so the same person stays selected no matter which row
			// they moved to; only a conversation that left the list entirely moves the
			// cursor, and then to the top of the list.
			const stillThere = action.conversations.some((entry) => entry.id === state.selectedId);
			const selectedId = stillThere ? state.selectedId : (action.conversations[0]?.id ?? null);
			return {
				...state,
				conversations: action.conversations,
				selectedId,
				// Only a different conversation starts at its newest message. A reorder keeps
				// the offset because it is still the same thread.
				scroll: selectedId === state.selectedId ? state.scroll : 0,
				// A reply belongs to the thread it was started in.
				replyToId: selectedId === state.selectedId ? state.replyToId : null,
				// A reaction prompt names a row in one thread, so it goes with the reply.
				reaction: selectedId === state.selectedId ? state.reaction : null,
				// So does a page request: leaving it pending would load history for whoever is
				// selected when the read lands, and shift a pane nobody asked to move.
				olderRequested: selectedId === state.selectedId ? state.olderRequested : false,
			};
		}
		case "move-selection": {
			const current = selectedIndex(state);
			if (current === -1) {
				return state;
			}
			const lastIndex = Math.max(0, state.conversations.length - 1);
			const nextIndex = Math.min(lastIndex, Math.max(0, current + action.delta));
			const next = state.conversations[nextIndex];
			return next === undefined || nextIndex === current
				? state
				: // A different conversation always starts at its newest message. The other way
					// round, the pane would open mid-history and look stale.
					{
						...state,
						selectedId: next.id,
						scroll: 0,
						replyToId: null,
						reaction: null,
						olderRequested: false,
					};
		}
		case "focus":
			return state.focus === action.focus ? state : { ...state, focus: action.focus };
		case "focus-next":
		case "focus-prev": {
			const step = action.type === "focus-next" ? 1 : -1;
			const index = FOCUS_ORDER.indexOf(state.focus);
			const next =
				FOCUS_ORDER[(index + step + FOCUS_ORDER.length) % FOCUS_ORDER.length] ?? state.focus;
			return next === state.focus ? state : { ...state, focus: next };
		}
		case "scroll-moved": {
			// How many messages fit is a rendering fact, but the oldest message is not:
			// without this bound a held key keeps counting up, and every press back then lands
			// on that dead range instead of moving the pane.
			const id = selectedConversation(state)?.id;
			const available = id === undefined ? 0 : (state.messagesByConversation[id]?.length ?? 0);
			const furthest = Math.max(0, available - 1);
			const next = Math.min(Math.max(0, state.scroll + action.delta), furthest);
			return next === state.scroll ? state : { ...state, scroll: next };
		}
		case "draft-changed": {
			// Only the transient send confirmation is cleared; other notices survive typing.
			const nextNotice = state.notice?.kind === "queued" ? null : state.notice;
			return state.draft === action.value && state.notice === nextNotice
				? state
				: { ...state, draft: action.value, notice: nextNotice };
		}
		case "draft-submitted": {
			const body = state.draft.trim();
			if (body.length === 0) {
				return state;
			}
			return {
				...state,
				draft: "",
				// The reply was sent with the text, so the next draft starts fresh.
				replyToId: null,
				notice: { kind: "queued", text: `queued: ${body}` },
			};
		}
		case "notice": {
			const current = state.notice;
			const next = action.notice;
			const unchanged =
				current === next || (current?.kind === next?.kind && current?.text === next?.text);
			return unchanged ? state : { ...state, notice: next };
		}
		default:
			return state;
	}
}
