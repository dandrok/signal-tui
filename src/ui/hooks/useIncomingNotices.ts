import { useEffect } from "react";
import { incomingSequence, type Writer } from "../../app/notify";
import type { Session } from "../../app/session";
import type { Action } from "../../app/state";

/**
 * A message nobody is looking at is the whole reason a notification exists: the thread on
 * screen needs none, and the session only announces rows it actually stored.
 *
 * The selected id is a dependency rather than a ref read, so the listener always compares
 * against the conversation the pane is showing right now. An arrival *older* than what is
 * loaded means the store has history behind the page boundary, which a walked-to-the-
 * beginning mark would refuse to reach — that is why it invalidates instead of notifying.
 */
export function useIncomingNotices(
	session: Session | undefined,
	selectedId: string | null,
	oldestSentAt: number | undefined,
	write: Writer,
	notify: boolean,
	dispatch: (action: Action) => void,
): void {
	useEffect(() => {
		if (session === undefined) {
			return;
		}
		return session.onIncoming((notice) => {
			if (notice.message.conversationId === selectedId) {
				if (oldestSentAt !== undefined && notice.message.sentAt < oldestSentAt) {
					dispatch({
						type: "history-invalidated",
						conversationId: notice.message.conversationId,
					});
				}
				return;
			}
			// Off silences the toast and the bell only. The unread badge and the window title
			// are not interruptions, and a muted pane still has to say something arrived.
			if (notify) {
				write(incomingSequence(notice));
			}
		});
	}, [session, write, notify, selectedId, oldestSentAt, dispatch]);
}
