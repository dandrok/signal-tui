import { Box, Text } from "ink";
import type { Clock } from "../../domain/format";
import { describeAuthor, headerLine, headerSuffix, showsBody } from "../../domain/format";
import {
	attachmentsForDisplay,
	bodyForDisplay,
	type QuoteLookup,
	quoteForDisplay,
	textForDisplay,
} from "../../domain/rows";
import type { Message } from "../../domain/types";
import { CURSOR_MARKER } from "./window";

/**
 * One message, measured against a shared row budget.
 *
 * The order is deliberate: the header is drawn first, then what it quotes, then the files, and
 * the body gets whatever is left — so neither a long name nor a long body can hide a peer's
 * filenames.
 */
export function MessageRow({
	message,
	rowBudget,
	innerWidth,
	clock,
	lookup,
	isCursor,
}: {
	readonly message: Message;
	readonly rowBudget: number;
	readonly innerWidth: number;
	readonly clock: Clock;
	readonly lookup: QuoteLookup;
	readonly isCursor: boolean;
}) {
	// Measured and drawn from one string: the marker is inside `fullHeader`, which is what
	// `messageRowCount` measured the window with.
	const marker = isCursor ? CURSOR_MARKER : "";
	const fullHeader = headerLine(message, clock, marker);
	// The suffix is one string for measurement and render: `headerLine` composes exactly
	// clock + space + author + suffix, so a marker cannot be counted and not drawn.
	const suffix = headerSuffix(message);
	const header = textForDisplay(fullHeader, rowBudget, innerWidth);
	// Same budget arithmetic as `messageOverheadRows`, which is what fitted the window:
	// header, then the quote, then the files, and the body takes the rest. `quoteForDisplay`
	// has already bounded itself to one row at this width, so the budget can only drop it.
	const quote = quoteForDisplay(message, innerWidth, clock, lookup);
	const quoteRows = Math.min(quote.rows, Math.max(0, rowBudget - header.rows));
	const files = attachmentsForDisplay(
		message,
		Math.max(0, rowBudget - header.rows - quoteRows),
		innerWidth,
	);
	const body = bodyForDisplay(
		message,
		Math.max(0, rowBudget - header.rows - quoteRows - files.rows),
		innerWidth,
	);

	return (
		<Box flexDirection="column">
			{header.text === fullHeader ? (
				<Text>
					{marker === "" ? null : <Text color="cyan">{marker}</Text>}
					<Text dimColor>{clock(message.sentAt)} </Text>
					<Text bold>{describeAuthor(message)}</Text>
					{suffix === "" ? null : <Text dimColor>{suffix}</Text>}
				</Text>
			) : (
				<Text>{header.text}</Text>
			)}
			{quoteRows > 0 ? <Text dimColor>{quote.text}</Text> : null}
			{showsBody(message) && body.rows > 0 ? (
				<Text dimColor={message.isDeleted}>{body.text}</Text>
			) : null}
			{files.lines.map((line, index) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: files render in the order signal-cli listed them and are replaced as a set, so a position is a stable key here
				<Text key={`${message.id}:${index}`} dimColor>
					{line}
				</Text>
			))}
			{/* Only when a row was actually reserved: with no budget left the marker would push
			    the title or the "older" label out of the pane. */}
			{files.omitted > 0 && files.rows > 0 ? (
				<Text dimColor>
					… +{files.omitted} more {files.omitted === 1 ? "file" : "files"}
				</Text>
			) : null}
		</Box>
	);
}
