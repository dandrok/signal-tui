import { Box, Text } from "ink";

export interface ComposerProps {
	readonly draft: string;
	readonly isFocused: boolean;
}

/** Frame plus one typing line. Fixed so the pane stack above it never jumps. */
export const COMPOSER_HEIGHT = 3;

/**
 * The input box. Focus is shown three ways — border colour, the `›` prompt and
 * the block cursor — because a terminal gives no caret to rely on.
 */
export function Composer({ draft, isFocused }: ComposerProps) {
	const empty = draft.length === 0;
	return (
		<Box
			flexDirection="column"
			borderStyle="round"
			borderColor={isFocused ? "green" : "gray"}
			paddingX={1}
			height={COMPOSER_HEIGHT}
		>
			<Box>
				<Text color={isFocused ? "green" : "gray"}>{isFocused ? "› " : "  "}</Text>
				<Text dimColor={!isFocused}>{draft}</Text>
				{isFocused ? <Text color="green">▌</Text> : null}
				{!isFocused && empty ? <Text dimColor>i to write</Text> : null}
			</Box>
		</Box>
	);
}
