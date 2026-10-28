import { useEffect, useState } from "react";
import type { Session } from "../../app/session";

/**
 * Who is writing in the thread on screen, re-asked while the answer is non-empty.
 *
 * A read with an expiry rather than a subscription: the session holds the notice and its
 * deadline, and the only thing missing is something that asks again once it passes — which this
 * timer is. It runs only while a line is actually showing, because a client idling on a quiet
 * thread should not tick once a second for nobody, and the render it forces is what takes the
 * line away when the deadline passes.
 */
export function useTyping(
	session: Session | undefined,
	conversationId: string | undefined,
): string | null {
	const [, recheck] = useState(0);
	const author =
		session === undefined || conversationId === undefined ? null : session.typingIn(conversationId);

	useEffect(() => {
		if (author === null) {
			return;
		}
		const timer = setInterval(() => recheck((count) => count + 1), 1_000);
		return () => clearInterval(timer);
	}, [author]);

	return author;
}
