import type { ConversationId } from "./types";

/**
 * Whether a conversation id names a single peer, which is what a receipt or a quote author
 * has to be.
 *
 * `sendReceipt` resolves its recipient as a phone number or a UUID, so a group id cannot be
 * passed through unchanged; the same test decides whether a direct chat's conversation id
 * can stand in for a message author that was never cached. It lives in `domain` because
 * both the reply rules and the session need it, and neither owns it.
 */
export function isDirectConversationId(conversationId: ConversationId): boolean {
	return /^\+?\d{5,}$/.test(conversationId) || /^[0-9a-fA-F-]{32,36}$/.test(conversationId);
}
