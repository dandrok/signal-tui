import { SELF_LABEL } from "../domain/format";
import type { ConversationId } from "../domain/types";
import { SELF_AUTHOR_ID } from "../domain/types";
import type { BackendEvent, SignalBackend } from "../ports/backend";
import type { MessageStore } from "../ports/store";

const MAX_ERRORS = 20;
/**
 * `sendReceipt` resolves its recipient as a phone number or a UUID, so a group
 * conversation cannot be passed through unchanged. Groups are skipped until the
 * receipt path for them is verified.
 */
export function isDirectConversationId(conversationId: ConversationId): boolean {
	return /^\+?\d{5,}$/.test(conversationId) || /^[0-9a-fA-F-]{32,36}$/.test(conversationId);
}

export interface SessionDeps {
	readonly store: MessageStore;
	readonly backend: SignalBackend;
	/** Milliseconds source; injectable so expiry tests need no sleeps. */
	readonly clock?: () => number;
}

/**
 * Joins the transport to the cache: every backend event is persisted, then
 * listeners are told something changed. Writes are serialised through one queue
 * so a fast burst of envelopes cannot interleave and land out of order (a
 * message before the conversation that owns it would break the foreign key).
 */
export interface Session {
	start(): Promise<void>;
	stop(): Promise<void>;
	send(conversationId: ConversationId, body: string): Promise<void>;
	/** Clears the unread count for a conversation the user is looking at. */
	markRead(conversationId: ConversationId): Promise<void>;
	/** Resolves once every queued write has been applied. */
	flush(): Promise<void>;
	onChange(listener: () => void): () => void;
	readonly errors: readonly string[];
}

export function createSession({ store, backend, clock = Date.now }: SessionDeps): Session {
	const now = (): number => clock();
	const listeners = new Set<() => void>();
	const errors: string[] = [];
	let queue: Promise<void> = Promise.resolve();

	const notify = (): void => {
		for (const listener of listeners) {
			listener();
		}
	};

	const record = (error: unknown): void => {
		errors.push(error instanceof Error ? error.message : String(error));
		if (errors.length > MAX_ERRORS) {
			errors.shift();
		}
	};

	const apply = async (event: BackendEvent): Promise<void> => {
		switch (event.kind) {
			case "conversation-updated":
				await store.upsertConversation(event.conversation);
				break;
			case "message": {
				const { inserted } = await store.saveMessage(event.message);
				// A replayed envelope must not count twice, so only a new row increments.
				if (inserted && !event.message.isOutgoing) {
					await store.incrementUnread(event.message.conversationId, 1);
				}
				break;
			}
			case "message-edited":
				await store.applyEdit(event.conversationId, event.targetSentAt, event.editor, event.body);
				break;
			case "message-deleted":
				await store.markMessageDeleted(event.conversationId, event.messageId);
				break;
		}
		// Every envelope is a chance to take out what has expired while the app runs.
		// Without this, a timer would only be honoured when a conversation is opened —
		// and a message nobody looks at would keep its text on disk indefinitely.
		await store.purgeExpired(now());
		notify();
	};

	// Subscribed before start() so no already-delivered envelope is missed.
	const unsubscribe = backend.subscribe((event) => {
		queue = queue.then(() => apply(event)).catch(record);
	});

	const sendReadReceipts = async (conversationId: ConversationId): Promise<void> => {
		if (!isDirectConversationId(conversationId)) {
			return;
		}
		try {
			// Not a page: marking read clears the state, so anything left out of a page
			// here would never be acknowledged.
			const messages = await store.listAllMessages(conversationId);
			const timestamps = messages
				.filter((entry) => !entry.isOutgoing && !entry.isDeleted)
				.map((entry) => entry.sentAt);
			await backend.sendReceipt(conversationId, timestamps);
		} catch (error) {
			record(error instanceof Error ? `receipt: ${error.message}` : String(error));
		}
	};

	return {
		async start(): Promise<void> {
			// Nothing purged while the app was closed, so the first thing a start does is
			// clear whatever expired in the meantime.
			await store.purgeExpired(now());
			await backend.start();
		},
		async stop(): Promise<void> {
			unsubscribe();
			await queue.catch(() => undefined);
			await backend.stop();
		},
		async markRead(conversationId: ConversationId): Promise<void> {
			// Queued so it runs after any pending increment: opening a conversation
			// while a message lands must end at zero, not one. Notification happens
			// only on a real change, otherwise listeners re-run markRead forever.
			let changed = false;
			queue = queue
				.then(async () => {
					changed = await store.markConversationRead(conversationId);
				})
				.catch(record);
			await queue;
			if (!changed) {
				return;
			}
			notify();

			// Tell the other side we actually read them, now that a human opened the
			// conversation — not when the message merely arrived.
			await sendReadReceipts(conversationId);
		},
		async send(conversationId: ConversationId, body: string): Promise<void> {
			const { timestamp } = await backend.sendMessage(conversationId, body);

			// Echo locally: Signal does not send a transcript back to the device that
			// wrote the message, so without this your own message never appears.
			// The server timestamp is the message's identity everywhere else, so a
			// delete-for-everyone from another device can match it.
			const sentAt = timestamp ?? Date.now();
			// Signal never echoes our own message back, so its expiry has to come from
			// the conversation timer the cache learned from incoming traffic.
			const timer = await store.expiresInSeconds(conversationId);
			queue = queue
				.then(async () => {
					await store.upsertConversation({
						id: conversationId,
						name: "",
						unreadCount: 0,
						lastActivityAt: sentAt,
					});
					await store.saveMessage({
						id: `${conversationId}:${sentAt}`,
						conversationId,
						author: SELF_LABEL,
						// Without this the row has no id and an edit would be matched on the
						// label alone — a group member whose display name is "You" could
						// then replace our message at the same timestamp.
						authorId: SELF_AUTHOR_ID,
						body,
						sentAt,
						isOutgoing: true,
						isDeleted: false,
						...(timer === undefined || timer <= 0 ? {} : { expiresAt: sentAt + timer * 1000 }),
					});
					notify();
				})
				.catch(record);

			await queue;
		},
		async flush(): Promise<void> {
			await queue.catch(() => undefined);
		},
		onChange(listener: () => void): () => void {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		get errors(): readonly string[] {
			return errors;
		},
	};
}
