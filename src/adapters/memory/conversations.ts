import type { Conversation, ConversationId } from "../../domain/types";

/**
 * The conversation half of the in-memory store: three rules that the SQLite upsert states in
 * SQL and this one states in JavaScript. Kept beside each other so a change to one is visibly
 * a change to the other, and tested by the same expectations in both adapters.
 */

/** What `upsertConversation` does: fill in what is known, never what is unknown. */
export function mergeConversation(
	conversations: readonly Conversation[],
	conversation: Conversation,
): Conversation[] {
	const index = conversations.findIndex((existing) => existing.id === conversation.id);
	const existing = conversations[index];
	if (existing === undefined) {
		return [...conversations, conversation];
	}
	// An empty name means "unknown" (a sync transcript carries only the destination id):
	// never let it erase a name learned from an incoming message.
	const name = conversation.name.trim().length > 0 ? conversation.name : existing.name;
	// A late-arriving transcript must not move a conversation backwards in the list; same
	// rule as the SQLite upsert. The unread count is owned by `addUnread`/`clearUnread`, so
	// a metadata update leaves it alone.
	const lastActivityAt = Math.max(existing.lastActivityAt, conversation.lastActivityAt);
	// Same rule again: an update that says nothing about the timer must not switch it off.
	const expiresInSeconds = conversation.expiresInSeconds ?? existing.expiresInSeconds;
	const merged: Conversation = {
		...conversation,
		name,
		lastActivityAt,
		unreadCount: existing.unreadCount,
		...(expiresInSeconds === undefined ? {} : { expiresInSeconds }),
	};
	const next = [...conversations];
	next[index] = merged;
	return next;
}

export function readExpiresInSeconds(
	conversations: readonly Conversation[],
	conversationId: ConversationId,
): number | undefined {
	return conversations.find((entry) => entry.id === conversationId)?.expiresInSeconds;
}

export function addUnread(
	conversations: readonly Conversation[],
	conversationId: ConversationId,
	by: number,
): Conversation[] {
	const index = conversations.findIndex((entry) => entry.id === conversationId);
	const existing = conversations[index];
	if (existing === undefined) {
		return [...conversations];
	}
	const next = [...conversations];
	next[index] = { ...existing, unreadCount: existing.unreadCount + by };
	return next;
}

/** Clearing an already-clear conversation reports no change — that is what stops the UI loop. */
export function clearUnread(
	conversations: readonly Conversation[],
	conversationId: ConversationId,
): { readonly conversations: Conversation[]; readonly changed: boolean } {
	const index = conversations.findIndex((entry) => entry.id === conversationId);
	const existing = conversations[index];
	if (existing === undefined || existing.unreadCount === 0) {
		return { conversations: [...conversations], changed: false };
	}
	const next = [...conversations];
	next[index] = { ...existing, unreadCount: 0 };
	return { conversations: next, changed: true };
}
