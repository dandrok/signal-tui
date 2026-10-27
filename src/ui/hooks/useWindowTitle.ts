import { useEffect } from "react";
import { title, unreadTitle, type Writer } from "../../app/notify";
import type { Conversation } from "../../domain/types";

/**
 * The window title carries what the sidebar would say, for when the window is behind
 * something else: the unread total, and the bare name at zero.
 */
export function useWindowTitle(conversations: readonly Conversation[], write: Writer): void {
	useEffect(() => {
		const unread = conversations.reduce((total, entry) => total + entry.unreadCount, 0);
		write(title(unreadTitle(unread)));
	}, [conversations, write]);
}
