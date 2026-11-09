import { Box, Text, useApp, useInput } from "ink";
import { useMemo } from "react";
import type { Action, AppState } from "../app/state";
import { conversationRows, pointedMessage } from "../app/state";
import { displayLine } from "../domain/display";
import { COMPOSER_HEIGHT, Composer, REPLYING_COMPOSER_HEIGHT } from "./Composer";
import { ConversationList } from "./ConversationList";
import { clockFor, localTimeZone } from "./clock";
import { hintsFor } from "./hints";
import { useTerminalSize } from "./hooks/useTerminalSize";
import { keyAction } from "./keys";
import { frameLayout } from "./layout";
import { MessagePane } from "./message-pane";
import { PromptBar } from "./PromptBar";
import { SearchPane } from "./SearchPane";

export interface AppProps {
	readonly state: AppState;
	readonly dispatch: (action: Action) => void;
	/** Who is writing in the open thread, or null. Shown in the composer, never stored. */
	readonly typing?: string | null;
	/**
	 * Where `o` is allowed to reach, for the status line's verdict. Passed down rather than read
	 * from the environment here, so the line and the launch answer the same question.
	 */
	readonly openRoot?: string | undefined;
}

/**
 * The layout, and nothing else: sizes, panes, the composer and the status line. What a key
 * does lives in `keys/`, what the line says in `hints.ts`.
 */
export function App({ state, dispatch, typing = null, openRoot }: AppProps) {
	const { exit } = useApp();
	const { columns, rows } = useTerminalSize();

	// Per-frame work stays O(1) + O(visible rows): the id → row map is rebuilt only when
	// the list itself changes, so typing a draft does not rescan the conversations.
	const rowsById = useMemo(() => conversationRows(state.conversations), [state.conversations]);
	const selectedRow = state.selectedId === null ? -1 : (rowsById.get(state.selectedId) ?? -1);
	const conversation = selectedRow === -1 ? undefined : state.conversations[selectedRow];
	const messages =
		conversation === undefined ? [] : (state.messagesByConversation[conversation.id] ?? []);
	const isSearching = state.search !== null;
	const isComposing = state.focus === "composer" && !isSearching;
	// The message being answered, resolved once per messages change rather than per frame.
	const messagesById = useMemo(
		() => new Map(messages.map((message) => [message.id, message] as const)),
		[messages],
	);
	const replyTo = state.replyToId === null ? undefined : messagesById.get(state.replyToId);

	useInput((input, key) => {
		const result = keyAction(state, input, key);
		if (result === null) {
			return;
		}
		if (result.kind === "exit") {
			exit();
			return;
		}
		dispatch(result.action);
	});

	// The domain never reads the host timezone nor holds a formatter cache: the UI
	// builds one cached clock here and hands it to the pane.
	const clock = useMemo(() => clockFor(localTimeZone()), []);
	const hints = hintsFor(state, replyTo !== undefined, openRoot);
	const notice = state.notice === null ? null : displayLine(state.notice.text);
	// Composed before the split because the status line's own height is part of the budget:
	// a hint line longer than the terminal is wide wraps, and a frame that grew a row is a
	// frame ink redraws one row off — the pane's rows then overlap.
	const statusText = notice === null ? hints : `${notice} · ${hints}`;
	const composerHeight = replyTo === undefined ? COMPOSER_HEIGHT : REPLYING_COMPOSER_HEIGHT;
	const layout = frameLayout(columns, rows, statusText, composerHeight);

	return (
		<Box flexDirection="column" width={columns} height={rows}>
			{isSearching && state.search !== null ? (
				<SearchPane search={state.search} width={columns} height={layout.bodyHeight} />
			) : (
				<Box flexDirection="row" height={layout.bodyHeight}>
					<ConversationList
						conversations={state.conversations}
						selectedIndex={selectedRow}
						width={layout.listWidth}
						height={layout.bodyHeight}
						isFocused={state.focus === "conversations"}
					/>
					<Box flexDirection="column" flexGrow={1}>
						<MessagePane
							conversation={conversation}
							messages={messages}
							width={layout.messageWidth}
							height={layout.messageHeight}
							scroll={state.scroll}
							cursorId={pointedMessage(state)?.id}
							isFocused={state.focus === "messages"}
							clock={clock}
						/>
						{state.prompt === null ? (
							<Composer
								draft={state.draft}
								isFocused={isComposing}
								width={layout.messageWidth}
								replyTo={replyTo}
								clock={clock}
								typing={typing}
							/>
						) : (
							<PromptBar prompt={state.prompt} width={layout.messageWidth} />
						)}
					</Box>
				</Box>
			)}

			{/* Clipped rather than allowed to grow: this box holds a fixed number of rows in the
			    frame's budget, so text past them is cut, never drawn over the composer. */}
			<Box paddingX={1} height={layout.statusRows} overflow="hidden" flexShrink={0}>
				{/* The notice goes first because the row is one line and Ink truncates its tail:
				    feedback about what just happened outranks a list of keys the user can look
				    up, and a notice that is the reason nothing happened must not be the part
				    that gets cut. */}
				{notice === null ? (
					<Text dimColor>{hints}</Text>
				) : (
					<Text color="green">
						{notice} · <Text dimColor>{hints}</Text>
					</Text>
				)}
			</Box>
		</Box>
	);
}
