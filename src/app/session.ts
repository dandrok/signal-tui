import { SELF_LABEL } from "../domain/format";
import type { ConversationId } from "../domain/types";
import type { BackendEvent, SignalBackend } from "../ports/backend";
import type { MessageStore } from "../ports/store";

const MAX_ERRORS = 20;
/** How many messages one receipt covers; older ones are already read. */
const RECEIPT_LIMIT = 100;

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

export function createSession({ store, backend }: SessionDeps): Session {
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
			case "message-deleted":
				await store.markMessageDeleted(event.conversationId, event.messageId);
				break;
		}
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
			const messages = await store.listMessages(conversationId, RECEIPT_LIMIT);
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
						body,
						sentAt,
						isOutgoing: true,
						isDeleted: false,
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
