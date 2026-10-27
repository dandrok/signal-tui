import { useEffect } from "react";
import type { Session } from "../../app/session";
import type { ConversationId } from "../../domain/types";

/**
 * The conversation on screen is read: clear its badge on open, and keep it clear while
 * messages arrive (`version` changes on every update, which is why it is a dependency
 * without being read here).
 */
export function useMarkRead(
	session: Session | undefined,
	conversationId: ConversationId | undefined,
	version: number,
): void {
	// biome-ignore lint/correctness/useExhaustiveDependencies: `version` is a reload trigger, not a value read by the effect.
	useEffect(() => {
		if (conversationId === undefined || session === undefined) {
			return;
		}
		void session.markRead(conversationId);
	}, [session, conversationId, version]);
}
