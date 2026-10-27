import type { Conversation, ConversationId, Message, Reaction } from "../../domain/types";
import { hydrate } from "./seed";

/** How many rows a read returns when the caller does not say. Matches the domain's page size. */
export const DEFAULT_LIMIT = 200;

/**
 * The read half of the in-memory store, as pure functions over the arrays it owns.
 *
 * Same split as the SQLite adapter (`read-messages.ts`), so a reader comparing the two sees
 * the same five functions answering the same five questions. The store keeps the arrays and
 * hands them over; nothing here mutates them.
 */

export function readConversations(conversations: readonly Conversation[]): readonly Conversation[] {
	return [...conversations].sort((a, b) => b.lastActivityAt - a.lastActivityAt);
}

/**
 * Reading order, and the tie-break the id already carries.
 *
 * The store appends on arrival, which is not send order: a sync transcript replays an hour of
 * history after a fresh message, and a page cut from insertion order then holds the wrong rows
 * — the newest two by arrival, not by time. SQLite orders in SQL; this is the same rule, and it
 * is what lets `store-parity.test.ts` compare the two arrays exactly.
 */
const inSendOrder = (messages: readonly Message[]): readonly Message[] =>
	[...messages].sort((left, right) => left.sentAt - right.sentAt || (left.id < right.id ? -1 : 1));

export function readMessages(
	messages: readonly Message[],
	reactions: ReadonlyMap<string, readonly Reaction[]>,
	conversationId: ConversationId,
	limit = DEFAULT_LIMIT,
): readonly Message[] {
	// `slice(-0)` is the whole array, not an empty one, so the empty page is spelled out.
	if (limit <= 0) {
		return [];
	}
	return inSendOrder(messages.filter((message) => message.conversationId === conversationId))
		.slice(-limit)
		.map((message) => hydrate(message, reactions.get(message.id)));
}

export function readMessagesBefore(
	messages: readonly Message[],
	reactions: ReadonlyMap<string, readonly Reaction[]>,
	conversationId: ConversationId,
	beforeSentAt: number,
	limit = DEFAULT_LIMIT,
): readonly Message[] {
	if (limit <= 0) {
		return [];
	}
	return inSendOrder(
		messages
			.filter((message) => message.conversationId === conversationId)
			.filter((message) => message.sentAt < beforeSentAt),
	)
		.slice(-limit)
		.map((message) => hydrate(message, reactions.get(message.id)));
}

export function readAllMessages(
	messages: readonly Message[],
	reactions: ReadonlyMap<string, readonly Reaction[]>,
	conversationId: ConversationId,
): readonly Message[] {
	return inSendOrder(messages.filter((entry) => entry.conversationId === conversationId)).map(
		(entry) => hydrate(entry, reactions.get(entry.id)),
	);
}

export function searchMessages(
	messages: readonly Message[],
	reactions: ReadonlyMap<string, readonly Reaction[]>,
	query: string,
	limit = 20,
): readonly Message[] {
	const needle = query.trim().toLowerCase();
	if (needle.length === 0) {
		return [];
	}
	return messages
		.filter((message) => !message.isDeleted && message.body.toLowerCase().includes(needle))
		.slice(0, limit)
		.map((message) => hydrate(message, reactions.get(message.id)));
}
