import { SELF_LABEL } from "./format";
import { isDirectConversationId } from "./ids";
import type { ConversationId, EditAuthor, Message } from "./types";
import { SELF_AUTHOR_ID } from "./types";

/**
 * The actor our own writes are attributed to: an edit or a delete made by this account.
 *
 * Both halves are needed because a row can be cached either way: since schema v4 it carries
 * `authorId` (ours is `SELF_AUTHOR_ID`), and before it the label `SELF_LABEL` was all there was.
 * Both stores match on whichever the row has, so identifying ourselves means naming both.
 */
export const SELF_ACTOR: EditAuthor = { id: SELF_AUTHOR_ID, label: SELF_LABEL };

/**
 * The identifier a message's author can be reached by, or null when there is none.
 *
 * Signal's `send` refuses a quote without a `quoteAuthor`, and `sendReaction` refuses a
 * reaction without a `targetAuthor` — both must be a number or a uuid. Two fallbacks keep
 * the common cases alive: our own message is always us, and in a direct chat the
 * conversation *is* the peer, which covers rows cached before schema v4 stored author ids at
 * all. In a group there is nothing to fall back to, because a display name is not an
 * identifier the engine can resolve.
 *
 * One rule, read by the reply path and the reaction path, so "can this row be acted on" has
 * a single answer.
 */
export function authorIdOf(message: Message, conversationId: ConversationId): string | null {
	if (message.authorId !== undefined) {
		return message.authorId;
	}
	if (message.isOutgoing) {
		return SELF_AUTHOR_ID;
	}
	return isDirectConversationId(conversationId) ? conversationId : null;
}
