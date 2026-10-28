import type { ConversationId } from "../../domain/types";

/**
 * Who is writing, right now — the one piece of session state that must never reach the cache.
 *
 * A typing notice is an assertion about the present, and a present that has passed is not worth
 * keeping: a client that stored it would open tomorrow showing someone composing a message they
 * sent last night. So this is a map and a deadline per entry, kept in memory, dropped on stop,
 * and swept by the clock the session already has.
 *
 * The TTL exists because the wire has no "gave up" message: a client that walks away mid-sentence
 * sends STARTED and then nothing, and the notice has to fade on its own. Signal's own clients
 * treat a typing notice as good for about ten seconds; eight leaves room for a slow envelope
 * without leaving a stale line on screen.
 */

export const TYPING_TTL_MS = 8_000;

export interface TypingNotice {
	readonly conversationId: ConversationId;
	readonly author: string;
	readonly isTyping: boolean;
}

export interface TypingState {
	/** Applies a notice and answers whether anything visible changed. */
	readonly apply: (notice: TypingNotice) => boolean;
	/** Who is writing in that conversation right now, or null. Forgets what expired. */
	readonly authorIn: (conversationId: ConversationId) => string | null;
}

export function createTyping(now: () => number): TypingState {
	const untilByConversation = new Map<ConversationId, { author: string; until: number }>();

	const live = (conversationId: ConversationId): { author: string; until: number } | undefined => {
		const entry = untilByConversation.get(conversationId);
		if (entry === undefined) {
			return undefined;
		}
		if (entry.until <= now()) {
			untilByConversation.delete(conversationId);
			return undefined;
		}
		return entry;
	};

	return {
		apply: (notice) => {
			const current = live(notice.conversationId);
			if (!notice.isTyping) {
				// STOPPED is only news when something was showing; otherwise every keystroke
				// that ended would redraw the pane for nothing.
				if (current === undefined) {
					return false;
				}
				untilByConversation.delete(notice.conversationId);
				return true;
			}
			const until = now() + TYPING_TTL_MS;
			// The label can change mid-sentence only if the envelope's name did; either way a
			// second STARTED is a redraw only when it says something different.
			const changed = current === undefined || current.author !== notice.author;
			untilByConversation.set(notice.conversationId, { author: notice.author, until });
			return changed;
		},
		authorIn: (conversationId) => live(conversationId)?.author ?? null,
	};
}
