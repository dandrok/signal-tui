import type { ConversationId, Message } from "../../domain/types";
import type { BackendEvent, ReplyTarget, SendResult, SignalBackend } from "../../ports/backend";
import { demoConversations } from "./demo-data";

/**
 * The transport `--demo` runs on: nothing leaves the process, and the sample thread answers you.
 *
 * Without it demo mode is a screenshot — arrows move a pointer over fixed rows, and the composer
 * accepts a draft it throws away, because every write in the session goes through the backend.
 * A backend that resolves instead of speaking JSON-RPC gives the demo the real write path: the
 * local echo, the reply marker and the read receipts are produced by the same code a live
 * account uses, so the demo shows what the client does rather than a second implementation of it.
 *
 * The scripted answer is what makes a send visible as a conversation: a typing notice, then a
 * line from whoever owns the thread. It is scheduled, not stored — a restart starts over, and
 * nothing about it is claimed on the wire.
 */

/** The person who answers in each demo thread, and what they say, in order. */
interface Responder {
	readonly author: string;
	readonly authorId: string;
	readonly lines: readonly string[];
}

const RESPONDERS: Readonly<Record<ConversationId, Responder>> = {
	"c-alice": {
		author: "Alice",
		authorId: "uuid-alice",
		lines: [
			"yep, the audio routing test passed this morning",
			"then ship it, I will watch the logs",
		],
	},
	"c-signal-devs": {
		author: "Marta",
		authorId: "uuid-marta",
		lines: ["the chunked path is on main now", "re-reading the diff, give me a minute"],
	},
	"c-family": {
		author: "Mum",
		authorId: "uuid-mum",
		lines: ["perfect, see you at 7", "bring the dessert you made last time?"],
	},
};

/** Long enough to read the echo land before the answer starts, short enough not to feel stuck. */
const TYPING_DELAY_MS = 600;
const REPLY_DELAY_MS = 1_800;

export interface DemoBackendOptions {
	/** How long after a send the answer appears. */
	readonly replyDelayMs?: number;
	/** When the typing notice appears, measured from the same send. */
	readonly typingDelayMs?: number;
	/** Milliseconds source, injectable so a test needs no sleeps. */
	readonly now?: () => number;
	/** Runs scheduled work; the seam a test replaces to answer without waiting. */
	readonly schedule?: (work: () => void, delayMs: number) => () => void;
}

export function createDemoBackend(options: DemoBackendOptions = {}): SignalBackend {
	const now = options.now ?? Date.now;
	const schedule =
		options.schedule ??
		((work: () => void, delayMs: number): (() => void) => {
			const timer = setTimeout(work, delayMs);
			return () => clearTimeout(timer);
		});
	const listeners = new Set<(event: BackendEvent) => void>();
	const pending = new Set<() => void>();
	/**
	 * Message identity is the instant, so two sends in the same millisecond would collide on
	 * `messages.id` — a fast Enter, Enter in demo mode would show one row instead of two.
	 */
	let lastStamp = 0;
	/** Which line each thread is on, so a second send answers with the second line. */
	const answered = new Map<ConversationId, number>();

	const emit = (event: BackendEvent): void => {
		for (const listener of listeners) {
			listener(event);
		}
	};

	const stamp = (): number => {
		lastStamp = Math.max(now(), lastStamp + 1);
		return lastStamp;
	};

	const later = (delayMs: number, work: () => void): void => {
		const cancel = schedule(() => {
			pending.delete(cancel);
			work();
		}, delayMs);
		pending.add(cancel);
	};

	/** Queues the thread's next line, or nothing when nobody is on the other side of it. */
	const answer = (conversationId: ConversationId): void => {
		const responder = RESPONDERS[conversationId];
		if (responder === undefined) {
			return;
		}
		const turn = answered.get(conversationId) ?? 0;
		answered.set(conversationId, turn + 1);
		const body = responder.lines[turn % responder.lines.length] ?? "";

		later(options.typingDelayMs ?? TYPING_DELAY_MS, () => {
			emit({ kind: "typing", conversationId, author: responder.author, isTyping: true });
		});
		later(options.replyDelayMs ?? REPLY_DELAY_MS, () => {
			const sentAt = stamp();
			// Saying nothing would leave `Marta is typing…` under her own message until the
			// eight-second expiry: the notice is a deadline, and only the answer meets it.
			emit({ kind: "typing", conversationId, author: responder.author, isTyping: false });
			// The name first, the way the engine sends it: a notification for a thread you are
			// not looking at has nothing else to call it.
			const seeded = demoConversations.find((entry) => entry.id === conversationId);
			if (seeded !== undefined) {
				emit({ kind: "conversation-updated", conversation: seeded });
			}
			const message: Message = {
				id: `${conversationId}:${sentAt}`,
				conversationId,
				author: responder.author,
				authorId: responder.authorId,
				body,
				sentAt,
				isOutgoing: false,
				isDeleted: false,
			};
			emit({ kind: "message", message });
		});
	};

	return {
		start: async () => undefined,
		stop: async () => {
			for (const cancel of pending) {
				cancel();
			}
			pending.clear();
		},
		// The session writes the local echo; a receipt here would only name a message the
		// engine would have to send, and nobody on the other side is reading.
		sendReceipt: async () => undefined,
		sendReaction: async () => undefined,
		deleteForEveryone: async () => undefined,
		sendEdit: async () => undefined,
		sendMessage: async (
			conversationId: ConversationId,
			_body: string,
			_replyTo?: ReplyTarget,
			_filePath?: string,
		): Promise<SendResult> => {
			const timestamp = stamp();
			answer(conversationId);
			return { timestamp };
		},
		subscribe: (listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
}
