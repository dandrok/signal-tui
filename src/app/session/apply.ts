import type { BackendEvent } from "../../ports/backend";
import type { SessionContext } from "./types";

/**
 * One backend event, written to the cache.
 *
 * Every envelope also sweeps what has expired while the app runs: without that, a timer
 * would only be honoured when a conversation is opened, and a message nobody looks at
 * would keep its text on disk indefinitely.
 */
export async function applyEvent(context: SessionContext, event: BackendEvent): Promise<void> {
	// Everything here changes the cache except one case: a reaction that repeats what is
	// stored, or names a message we do not have. Redrawing for it would be a full reload
	// of the pane per replayed envelope after a reconnect.
	let changed = true;
	const { store } = context;

	switch (event.kind) {
		case "conversation-updated":
			await store.upsertConversation(event.conversation);
			// Kept for the notification: the name arrives before the message that needs it.
			if (event.conversation.name.length > 0) {
				context.learnName(event.conversation.id, event.conversation.name);
			}
			break;
		case "message": {
			const { inserted } = await store.saveMessage(event.message);
			// A replayed envelope must not count twice, so only a new row increments.
			if (inserted && !event.message.isOutgoing) {
				await store.incrementUnread(event.message.conversationId, 1);
				// Announced after the write, so a notice never describes something the cache
				// refused to keep — and never a replay of it.
				context.announce(event.message);
			}
			break;
		}
		case "message-edited":
			await store.applyEdit(event.conversationId, event.targetSentAt, event.editor, event.body);
			break;
		case "message-deleted":
			await store.markMessageDeleted(event.conversationId, event.messageId);
			break;
		case "reaction":
			// A reaction is about a message the cache already has; when it is not there,
			// the store answers false and nothing is invented.
			changed = await store.applyReaction(
				event.conversationId,
				event.targetSentAt,
				{
					emoji: event.emoji,
					author: event.reactor.label,
					authorId: event.reactor.id ?? event.reactor.label,
				},
				event.isRemove,
			);
			break;
		case "receipt":
			// The tick is a cache fact, not a render fact: it has to survive a restart,
			// which is why the store takes it rather than the pane remembering it.
			await store.applyReceipt(event.timestamps, event.state);
			break;
	}

	const purged = await store.purgeExpired(context.now());
	if (changed || purged > 0) {
		context.notify();
	}
}
