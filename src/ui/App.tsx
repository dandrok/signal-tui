import { Box, Text, useApp, useInput } from "ink";
import type { Action, AppState } from "../app/state";
import { selectedConversation, selectedMessages } from "../app/state";
import { COMPOSER_HEIGHT, Composer } from "./Composer";
import { ConversationList } from "./ConversationList";
import { useTerminalSize } from "./hooks/useTerminalSize";
import { MessagePane } from "./MessagePane";
import { SearchPane } from "./SearchPane";

export interface AppProps {
	readonly state: AppState;
	readonly dispatch: (action: Action) => void;
}

/** Rows a page of `j`/`k` covers while the message pane owns the keyboard. */
const SCROLL_STEP = 10;

const hintsFor = (isComposing: boolean, focus: AppState["focus"]): string => {
	if (isComposing) {
		return "⏎ send · esc back · tab panes";
	}
	const panes = "tab panes · i compose · / search · q quit";
	return focus === "messages" ? `j/k scroll · ⇞/⇟ page · ${panes}` : `j/k move · ${panes}`;
};

export function App({ state, dispatch }: AppProps) {
	const { exit } = useApp();
	const { columns, rows } = useTerminalSize();

	const conversation = selectedConversation(state);
	const messages = selectedMessages(state);
	const isSearching = state.search !== null;
	const isComposing = state.focus === "composer" && !isSearching;

	useInput((input, key) => {
		if (key.ctrl && input === "c") {
			exit();
			return;
		}

		if (isSearching) {
			if (key.escape) {
				dispatch({ type: "search-closed" });
				return;
			}
			if (key.return) {
				dispatch({ type: "search-selected" });
				return;
			}
			if (key.upArrow) {
				dispatch({ type: "search-moved", delta: -1 });
				return;
			}
			if (key.downArrow) {
				dispatch({ type: "search-moved", delta: 1 });
				return;
			}
			if (key.backspace || key.delete) {
				dispatch({ type: "search-changed", query: (state.search?.query ?? "").slice(0, -1) });
				return;
			}
			if (input.length > 0) {
				dispatch({ type: "search-changed", query: (state.search?.query ?? "") + input });
			}
			return;
		}

		if (isComposing) {
			if (key.return) {
				dispatch({ type: "draft-submitted" });
				return;
			}
			if (key.escape) {
				dispatch({ type: "focus", focus: "messages" });
				return;
			}
			if (key.backspace || key.delete) {
				dispatch({ type: "draft-changed", value: state.draft.slice(0, -1) });
				return;
			}
			dispatch({ type: "draft-changed", value: state.draft + input });
			return;
		}

		// Tab walks the panes whether or not one of them is "active": the border
		// colour is the only thing that says where the keyboard is pointing.
		if (key.tab) {
			dispatch({ type: key.shift ? "focus-prev" : "focus-next" });
			return;
		}

		if (input === "q") {
			exit();
			return;
		}
		if (input === "/") {
			dispatch({ type: "search-opened" });
			return;
		}
		if (input === "i" || key.return) {
			dispatch({ type: "focus", focus: "composer" });
			return;
		}

		const inMessages = state.focus === "messages";
		if (inMessages && key.pageUp) {
			dispatch({ type: "scroll-moved", delta: SCROLL_STEP });
			return;
		}
		if (inMessages && key.pageDown) {
			dispatch({ type: "scroll-moved", delta: -SCROLL_STEP });
			return;
		}
		if (input === "j") {
			dispatch(
				inMessages ? { type: "scroll-moved", delta: -1 } : { type: "move-selection", delta: 1 },
			);
			return;
		}
		if (input === "k") {
			dispatch(
				inMessages ? { type: "scroll-moved", delta: 1 } : { type: "move-selection", delta: -1 },
			);
		}
	});

	const listWidth = Math.max(22, Math.min(32, Math.floor(columns * 0.3)));
	const bodyHeight = Math.max(8, rows - 1);
	const messageHeight = Math.max(5, bodyHeight - COMPOSER_HEIGHT);
	const messageWidth = Math.max(20, columns - listWidth);

	return (
		<Box flexDirection="column" width={columns} height={rows}>
			{isSearching && state.search !== null ? (
				<SearchPane search={state.search} width={columns} height={bodyHeight} />
			) : (
				<Box flexDirection="row" height={bodyHeight}>
					<ConversationList
						conversations={state.conversations}
						selectedIndex={state.selectedIndex}
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
							isFocused={state.focus === "messages"}
						/>
						<Composer draft={state.draft} isFocused={isComposing} />
					</Box>
				</Box>
			)}

			<Box paddingX={1}>
				<Text dimColor>{hintsFor(isComposing, state.focus)}</Text>
				{state.notice ? <Text color="green"> · {state.notice.text}</Text> : null}
			</Box>
		</Box>
	);
}
