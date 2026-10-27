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
import { keyAction } from "./keymap";
import { MessagePane } from "./MessagePane";
import { ReactionPrompt } from "./ReactionPrompt";
import { SearchPane } from "./SearchPane";

export interface AppProps {
	readonly state: AppState;
	readonly dispatch: (action: Action) => void;
}

/**
 * The layout, and nothing else: sizes, panes, the composer and the status line. What a key
 * does lives in `keymap.ts`, what the line says in `hints.ts`.
 */
export function App({ state, dispatch }: AppProps) {
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
	const listWidth = Math.max(22, Math.min(32, Math.floor(columns * 0.3)));
	const bodyHeight = Math.max(8, rows - 1);
	const composerHeight = replyTo === undefined ? COMPOSER_HEIGHT : REPLYING_COMPOSER_HEIGHT;
	const messageHeight = Math.max(5, bodyHeight - composerHeight);
	const messageWidth = Math.max(20, columns - listWidth);

	return (
		<Box flexDirection="column" width={columns} height={rows}>
			{isSearching && state.search !== null ? (
				<SearchPane search={state.search} width={columns} height={bodyHeight} />
			) : (
				<Box flexDirection="row" height={bodyHeight}>
					<ConversationList
						conversations={state.conversations}
						selectedIndex={selectedRow}
						width={listWidth}
						height={bodyHeight}
						isFocused={state.focus === "conversations"}
					/>
					<Box flexDirection="column" flexGrow={1}>
						<MessagePane
							conversation={conversation}
							messages={messages}
							width={messageWidth}
							height={messageHeight}
							scroll={state.scroll}
							cursorId={pointedMessage(state)?.id}
							isFocused={state.focus === "messages"}
							clock={clock}
						/>
						{state.reaction === null ? (
							<Composer
								draft={state.draft}
								isFocused={isComposing}
								width={messageWidth}
								replyTo={replyTo}
								clock={clock}
							/>
						) : (
							<ReactionPrompt draft={state.reaction.draft} width={messageWidth} />
						)}
					</Box>
				</Box>
			)}

			<Box paddingX={1}>
				<Text dimColor>{hintsFor(state, replyTo !== undefined)}</Text>
				{state.notice ? <Text color="green"> · {displayLine(state.notice.text)}</Text> : null}
			</Box>
		</Box>
	);
}
