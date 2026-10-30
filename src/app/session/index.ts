import type { MessageRef } from "../../domain/message-ref";
import type { ConversationId, Message, MessageId } from "../../domain/types";
import type { ReplyTarget } from "../../ports/backend";
import { applyEvent } from "./apply";
import { listContacts, startDirect } from "./direct";
import { sendEdit } from "./edit";
import { hideMessage } from "./hide";
import { markReadConversation } from "./mark-read";
import { sendReaction } from "./react";
import { removeMessage } from "./remove";
import { sendText } from "./send";
import type { IncomingNotice, SentFile, Session, SessionContext, SessionDeps } from "./types";
import { createTyping } from "./typing";

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
	/**
	 * Typing is the one event that never reaches the store or the queue: it is an assertion
	 * about the present, it expires, and a write would make it survive a restart. Handled
	 * before `enqueue` for exactly that reason.
	 */
	const typing = createTyping(() => clock());

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
		if (event.kind === "typing") {
			// A redraw only when the line on screen would change: a STOPPED for someone who
			// was not shown is not news.
			if (typing.apply(event)) {
				notify();
			}
			return;
		}
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
		startDirect: (conversationId: ConversationId, name: string): Promise<void> =>
			startDirect(context, conversationId, name),
		listContacts: () => listContacts(context),
		typingIn: (conversationId: ConversationId): string | null => typing.authorIn(conversationId),
		send: (
			conversationId: ConversationId,
			body: string,
			replyTo?: ReplyTarget,
			file?: SentFile,
		): Promise<void> => sendText(context, conversationId, body, replyTo, file),
		react: (
			conversationId: ConversationId,
			target: MessageRef,
			emoji: string,
			isRemove = false,
		): Promise<void> => sendReaction(context, conversationId, target, emoji, isRemove),
		edit: (conversationId: ConversationId, target: MessageRef, body: string): Promise<void> =>
			sendEdit(context, conversationId, target, body),
		remove: (conversationId: ConversationId, target: MessageRef): Promise<void> =>
			removeMessage(context, conversationId, target),
		hide: (conversationId: ConversationId, messageId: MessageId): Promise<void> =>
			hideMessage(context, conversationId, messageId),
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
export type { IncomingNotice, SentFile, Session, SessionDeps } from "./types";
