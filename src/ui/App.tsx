import { Box, Text, useApp, useInput } from "ink";
import type { Action, AppState } from "../app/state";
import { selectedConversation, selectedMessages } from "../app/state";
import { ConversationList } from "./ConversationList";
import { useTerminalSize } from "./hooks/useTerminalSize";
import { MessagePane } from "./MessagePane";

export interface AppProps {
	readonly state: AppState;
	readonly dispatch: (action: Action) => void;
}

const NORMAL_HINTS = "j/k move · i or ⏎ compose · q quit";
const COMPOSER_HINTS = "⏎ send · esc back";

export function App({ state, dispatch }: AppProps) {
	const { exit } = useApp();
	const { columns, rows } = useTerminalSize();

	const conversation = selectedConversation(state);
	const messages = selectedMessages(state);
	const isComposing = state.focus === "composer";

	useInput((input, key) => {
		if (key.ctrl && input === "c") {
			exit();
			return;
		}

		if (isComposing) {
			if (key.return) {
				dispatch({ type: "draft-submitted" });
				return;
			}
			if (key.escape) {
				dispatch({ type: "focus", focus: "conversations" });
				return;
			}
			if (key.backspace || key.delete) {
				dispatch({ type: "draft-changed", value: state.draft.slice(0, -1) });
				return;
			}
			dispatch({ type: "draft-changed", value: state.draft + input });
			return;
		}

		if (input === "q") {
			exit();
			return;
		}
		if (input === "j") {
			dispatch({ type: "move-selection", delta: 1 });
			return;
		}
		if (input === "k") {
			dispatch({ type: "move-selection", delta: -1 });
			return;
		}
		if (input === "i" || input === "/" || key.return) {
			dispatch({ type: "focus", focus: "composer" });
		}
	});

	const listWidth = Math.max(22, Math.min(32, Math.floor(columns * 0.3)));
	const chromeRows = 3;
	const bodyHeight = Math.max(6, rows - chromeRows);

	return (
		<Box flexDirection="column" width={columns} height={rows}>
			<Box flexDirection="row" height={bodyHeight}>
				<ConversationList
					conversations={state.conversations}
					selectedIndex={state.selectedIndex}
					width={listWidth}
					height={bodyHeight}
				/>
				<MessagePane conversation={conversation} messages={messages} height={bodyHeight} />
			</Box>

			<Box paddingX={1}>
				<Text dimColor>{isComposing ? COMPOSER_HINTS : NORMAL_HINTS}</Text>
				{state.notice ? <Text color="green"> · {state.notice.text}</Text> : null}
			</Box>

			<Box paddingX={1}>
				<Text color={isComposing ? "green" : "gray"}>{isComposing ? "› " : "  "}</Text>
				<Text>{state.draft}</Text>
				{isComposing ? <Text color="green">▌</Text> : null}
			</Box>
		</Box>
	);
}
