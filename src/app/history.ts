import type { ConversationId, Message } from "../domain/types";
import { selectedConversation } from "./conversations";
import { canAnswerIn } from "./reply";
import type { Action, AppState } from "./state";

/**
 * Walking back through a conversation's history, as state transitions.
 *
 * Split out of `state.ts` when the reducer outgrew the file cap, and kept here because these
 * four transitions are one subject: what the pane has loaded, how much further back it has
 * been, and what invalidates that.
 *
 * `AppState` and `Action` are imported as types, so the module graph stays one-directional at
 * runtime: `state.ts` reaches in, never the other way round.
 */

/** One copy of each message, in the order given; a later entry replaces an earlier one. */
function dedupeById(messages: readonly Message[]): readonly Message[] {
	const byId = new Map<string, Message>();
	for (const message of messages) {
		byId.set(message.id, message);
	}
	return [...byId.values()];
}

/** The completion marks minus one thread. */
function withoutKey(
	marks: Readonly<Record<string, true>>,
	conversationId: string,
): Readonly<Record<string, true>> {
	const { [conversationId]: _dropped, ...rest } = marks;
	return rest;
}

type LoadedAction = Extract<Action, { type: "messages-loaded" }>;
type OlderAction = Extract<Action, { type: "older-loaded" }>;

export function applyMessagesLoaded(state: AppState, action: LoadedAction): AppState {
	const loaded = action.messages;
	const previous = state.messagesByConversation[action.conversationId] ?? [];
	// History the user walked back to survives a reload. The fresh page is the newest
	// slice, so everything older than its first row is kept ahead of it — otherwise an
	// incoming message would throw away the pages behind it and the pane would jump.
	const oldestFresh = loaded[0]?.sentAt;
	const newestPrevious = previous.at(-1)?.sentAt;
	// Kept history is only contiguous with the fresh page if the page reaches back to it.
	// A conversation left unselected while more than a page arrived comes back with a gap
	// between the rows we kept and the newest slice — and that gap is unreachable, because
	// paging walks from `merged[0]`. Drop the stale prefix instead of showing a hole.
	const contiguous =
		oldestFresh === undefined || newestPrevious === undefined || oldestFresh <= newestPrevious;
	const older =
		contiguous && oldestFresh !== undefined ? previous.filter((m) => m.sentAt < oldestFresh) : [];
	const merged = dedupeById([...older, ...loaded]);
	// A row that stays in the list can still stop being answerable: a
	// delete-for-everyone and a timer both keep the row and blank its text. Keeping
	// the target in that case is what makes the composer claim a reply the send path
	// then refuses — the message goes out plain and the user is told nothing.
	const forSelected = action.conversationId === state.selectedId;
	const stillAnswerable =
		state.replyToId !== null &&
		merged.some(
			(message) => message.id === state.replyToId && canAnswerIn(message, action.conversationId),
		);
	return {
		...state,
		messagesByConversation: {
			...state.messagesByConversation,
			[action.conversationId]: merged,
		},
		// The window is anchored to the newest message, so the offset cannot exceed it.
		scroll: Math.min(state.scroll, Math.max(0, merged.length - 1)),
		replyToId:
			state.replyToId !== null && (!forSelected || stillAnswerable) ? state.replyToId : null,
		// Rows were dropped, so anything known about the beginning is no longer true.
		...(contiguous
			? {}
			: { historyComplete: withoutKey(state.historyComplete, action.conversationId) }),
	};
}

export function requestOlder(state: AppState): AppState {
	const conversation = selectedConversation(state);
	if (
		conversation === undefined ||
		state.olderRequested ||
		state.historyComplete[conversation.id] === true
	) {
		return state;
	}
	return { ...state, olderRequested: true };
}

export function applyOlderLoaded(state: AppState, action: OlderAction): AppState {
	const conversationId = action.conversationId;
	if (action.messages.length === 0) {
		// A short (or empty) page is the beginning of the thread: stop asking.
		return {
			...state,
			olderRequested: false,
			historyComplete: { ...state.historyComplete, [conversationId]: true },
		};
	}
	const current = state.messagesByConversation[conversationId] ?? [];
	const merged = dedupeById([...action.messages, ...current]);
	const added = merged.length - current.length;
	return {
		...state,
		messagesByConversation: { ...state.messagesByConversation, [conversationId]: merged },
		// The window is measured from the newest row: growing the list by N older ones
		// hides N more above it, which is what keeps the message you were reading still.
		scroll: state.scroll + added,
		olderRequested: false,
		historyComplete:
			action.hasMore && state.historyComplete[conversationId] !== true
				? state.historyComplete
				: { ...state.historyComplete, [conversationId]: true },
	};
}

export function releaseOlder(state: AppState): AppState {
	return state.olderRequested ? { ...state, olderRequested: false } : state;
}

export function invalidateHistory(state: AppState, conversationId: ConversationId): AppState {
	// The store can gain rows older than the page boundary — a message delivered out
	// of order, or a replay of an old envelope — and the newest-N reload will never
	// show them. Dropping the "walked to the beginning" mark makes the next request
	// find them instead of refusing forever.
	if (state.historyComplete[conversationId] !== true) {
		return state;
	}
	const { [conversationId]: _dropped, ...rest } = state.historyComplete;
	return { ...state, historyComplete: rest };
}
