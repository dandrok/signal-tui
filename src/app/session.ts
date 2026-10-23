import { SELF_LABEL } from "../domain/format";
import type { ConversationId } from "../domain/types";
import type { BackendEvent, SignalBackend } from "../ports/backend";
import type { MessageStore } from "../ports/store";

const MAX_ERRORS = 20;

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
			case "message":
				await store.saveMessage(event.message);
				break;
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

	return {
		async start(): Promise<void> {
			await backend.start();
		},
		async stop(): Promise<void> {
			unsubscribe();
			await queue.catch(() => undefined);
			await backend.stop();
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
