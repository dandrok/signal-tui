import type { ConversationId } from "../../domain/types";
import type { SessionContext } from "./types";

/**
 * Opening a conversation nobody has written in yet.
 *
 * A thread with no messages does not exist on the wire — Signal has no "create a chat" — so this
 * is a cache row and nothing else: the list has somewhere to put the new thread, the composer has
 * somewhere to send from, and the first message is what makes it real. That is also why it is
 * cheap: no round-trip, no failure mode, and no half-created conversation on the other side.
 *
 * The row is written through the same queue as every other store write, so a send typed a moment
 * later cannot reach the engine before the conversation it belongs to exists.
 */
export async function startDirect(
	context: SessionContext,
	conversationId: ConversationId,
	name: string,
): Promise<void> {
	await context.enqueue(async () => {
		// Re-opening a thread must not move it to the top of the list: `upsertConversation` keeps
		// the later of the two activity times, so writing `now()` here would date an old
		// conversation as if it had just received a message. Only a row that does not exist yet
		// is dated now; an existing one keeps the time it already had.
		const existing = (await context.store.listConversations()).find(
			(entry) => entry.id === conversationId,
		);
		await context.store.upsertConversation({
			id: conversationId,
			// An empty name means "unknown" to `mergeConversation`, so a known contact's name would
			// be kept over it — the number-as-name is only for someone nobody has named.
			name,
			unreadCount: 0,
			lastActivityAt: existing?.lastActivityAt ?? context.now(),
		});
		context.notify();
	});
}

/**
 * The account's contacts, from the engine's own sync.
 *
 * Not stored: the engine refreshes them on its own schedule, and a cache of a directory that moves
 * would answer a question nobody asked ("who did I know last Tuesday"). The picker asks when it
 * opens, which is free — the engine answers from memory.
 */
export async function listContacts(context: SessionContext) {
	return context.backend.listContacts();
}
