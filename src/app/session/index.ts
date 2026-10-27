import type { ConversationId, Message } from "../../domain/types";
import type { ReactionTarget, ReplyTarget } from "../../ports/backend";
import { applyEvent } from "./apply";
import { markReadConversation } from "./mark-read";
import { sendReaction } from "./react";
import { sendText } from "./send";
import type { IncomingNotice, Session, SessionContext, SessionDeps } from "./types";

/**
 * The session: one write queue, one redraw signal, one error log, and the use cases in
 * this folder wired to them. Everything below is either lifecycle or delegation — the
 * actual work lives in `apply.ts`, `send.ts`, `mark-read.ts` and `receipts.ts`.
 */

const MAX_ERRORS = 20;

export function createSession({ store, backend, clock = Date.now }: SessionDeps): Session {
	const listeners = new Set<() => void>();
	const incomingListeners = new Set<(notice: IncomingNotice) => void>();
	/**
	 * Names learned from `conversation-updated`, which the backend emits before the message
	 * it belongs to. A notification needs a name, and asking the store for it inside the
	 * envelope queue would put a read in front of every write.
	 */
	const names = new Map<ConversationId, string>();
	const errors: string[] = [];
	let queue: Promise<void> = Promise.resolve();

	const notify = (): void => {
		for (const listener of listeners) {
			listener();
		}
	};

	const announce = (message: Message): void => {
		const notice: IncomingNotice = {
			message,
			conversationName: names.get(message.conversationId) ?? "",
		};
		for (const listener of incomingListeners) {
			listener(notice);
		}
	};

	const record = (error: unknown): void => {
		errors.push(error instanceof Error ? error.message : String(error));
		if (errors.length > MAX_ERRORS) {
			errors.shift();
		}
	};

	const enqueue = (work: () => Promise<void>): Promise<void> => {
		queue = queue.then(work).catch(record);
		return queue;
	};

	const context: SessionContext = {
		store,
		backend,
		now: () => clock(),
		enqueue,
		notify,
		announce,
		record,
		nameOf: (conversationId) => names.get(conversationId) ?? "",
		learnName: (conversationId, name) => {
			names.set(conversationId, name);
		},
	};

	// Subscribed before start() so no already-delivered envelope is missed.
	const unsubscribe = backend.subscribe((event) => {
		void enqueue(() => applyEvent(context, event));
	});

	return {
		async start(): Promise<void> {
			// Nothing purged while the app was closed, so the first thing a start does is
			// clear whatever expired in the meantime.
			await store.purgeExpired(context.now());
			await backend.start();
		},
		async stop(): Promise<void> {
			unsubscribe();
			await queue.catch(() => undefined);
			await backend.stop();
		},
		markRead: (conversationId: ConversationId): Promise<void> =>
			markReadConversation(context, conversationId),
		send: (conversationId: ConversationId, body: string, replyTo?: ReplyTarget): Promise<void> =>
			sendText(context, conversationId, body, replyTo),
		react: (conversationId: ConversationId, target: ReactionTarget, emoji: string): Promise<void> =>
			sendReaction(context, conversationId, target, emoji),
		async flush(): Promise<void> {
			await queue.catch(() => undefined);
		},
		onChange(listener: () => void): () => void {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		onIncoming(listener: (notice: IncomingNotice) => void): () => void {
			incomingListeners.add(listener);
			return () => {
				incomingListeners.delete(listener);
			};
		},
		get errors(): readonly string[] {
			return errors;
		},
	};
}

export { isDirectConversationId } from "../../domain/ids";
export type { IncomingNotice, Session, SessionDeps } from "./types";
