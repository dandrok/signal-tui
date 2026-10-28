import { useMemo } from "react";
import type { Writer } from "../app/notify";
import type { Session } from "../app/session";
import { selectedConversation } from "../app/state";
import { type AttachContext, defaultAttachContext } from "../app/usecases/attach";
import type { MessageStore } from "../ports/store";
import { App } from "./App";
import { useConversations } from "./hooks/useConversations";
import { useIncomingNotices } from "./hooks/useIncomingNotices";
import { useMarkRead } from "./hooks/useMarkRead";
import { useOlderPage } from "./hooks/useOlderPage";
import { useRootState } from "./hooks/useRootState";
import { useSearchMode } from "./hooks/useSearchMode";
import { useThreadMessages } from "./hooks/useThreadMessages";
import { useTyping } from "./hooks/useTyping";
import { useWindowTitle } from "./hooks/useWindowTitle";

export interface RootProps {
	readonly store: MessageStore;
	/** Absent in demo mode: there is nothing to send to and nothing to listen for. */
	readonly session?: Session | undefined;
	/** Where notification sequences go. Injectable so tests can collect them. */
	readonly write?: Writer | undefined;
	/**
	 * Whether an arriving message may ring and toast. Off is a preference, not a mute of the
	 * inbox: the unread badge and the window title still count what arrived.
	 */
	readonly notify?: boolean | undefined;
	/**
	 * Where the attach prompt reads paths from. Injectable so a test can point it at a directory
	 * it made, instead of whatever directory the test runner happens to start in.
	 */
	readonly attachments?: AttachContext | undefined;
}

/** Nothing is written unless a person is looking at a terminal: piped output stays clean. */
const stdoutWriter: Writer = (chunk) => {
	if (process.stdout.isTTY === true) {
		process.stdout.write(chunk);
	}
};

/**
 * Composition, not logic: app state in, panes out, and one hook per side effect.
 *
 * Each hook owns exactly one conversation with the outside world — the cache, the session's
 * redraw signal, the notification writer — so a new feature adds a hook (or a key to
 * `keys/`) instead of another effect in a file that already holds nine.
 */
export function Root({
	store,
	session,
	write = stdoutWriter,
	notify = true,
	attachments,
}: RootProps) {
	// One identity for the whole session: the attach context is a dependency of the dispatcher,
	// and a fresh object per render would re-subscribe every effect that names it.
	const paths = useMemo(() => attachments ?? defaultAttachContext(), [attachments]);
	const { state, dispatch, version } = useRootState(session, paths);

	// Derived once per render: the hooks below compare against the thread on screen, and a
	// value read by an effect belongs in its dependencies rather than behind a ref.
	const conversationId = selectedConversation(state)?.id;
	const oldestSentAt =
		conversationId === undefined
			? undefined
			: state.messagesByConversation[conversationId]?.[0]?.sentAt;

	useConversations(store, version, dispatch);
	useThreadMessages(store, conversationId, version, dispatch);
	useOlderPage(store, state.olderRequested, conversationId, oldestSentAt, dispatch);
	useMarkRead(session, conversationId, version);
	useSearchMode(store, state.search?.query ?? null, dispatch);
	useIncomingNotices(session, state.selectedId, oldestSentAt, write, notify, dispatch);
	useWindowTitle(state.conversations, write);

	// Asked again on its own timer rather than pushed: the notice expires, and the render that
	// follows the expiry is what takes the line off the screen.
	const typing = useTyping(session, conversationId);

	return <App state={state} dispatch={dispatch} typing={typing} />;
}
