import { Box, Text } from "ink";
import type { Clock } from "../../domain/format";
import { describeAuthor, headerSuffix, showsBody } from "../../domain/format";
import {
	attachmentsForDisplay,
	bodyForDisplay,
	headerTextFor,
	type QuoteLookup,
	quoteForDisplay,
	textForDisplay,
} from "../../domain/rows";
import type { Message } from "../../domain/types";
import { CURSOR_MARKER } from "./window";

/**
 * Two columns to the left of every message: the bar, and the space after it.
 *
 * It is spent by messages you did not send too — as blanks — because the bar is worth a
 * vertical line you can follow down the thread, and that only works if every message's text
 * starts in the same column.
 */
export const GUTTER_WIDTH = 2;

const OWN_GUTTER = "▌ ";
const PEER_GUTTER = "  ";

/** One entry per drawn row, so a body that wrapped still gets a bar on every line. */
const linesOf = (text: string): readonly string[] => text.split("\n");

/**
 * One message, measured against a shared row budget.
 *
 * The order is deliberate: the header is drawn first (unless this message continues the block
 * above), then what it quotes, then the files, and the body gets whatever is left — so neither a
 * long name nor a long body can hide a peer's filenames.
 */
export function MessageRow({
	message,
	previous,
	rowBudget,
	innerWidth,
	clock,
	lookup,
	isCursor,
}: {
	readonly message: Message;
	/** The message above it, which decides whether this row repeats the author. */
	readonly previous: Message | undefined;
	readonly rowBudget: number;
	readonly innerWidth: number;
	readonly clock: Clock;
	readonly lookup: QuoteLookup;
	readonly isCursor: boolean;
}) {
	// Measured and drawn from one string: the marker is inside `fullHeader`, which is what
	// `messageRowCount` measured the window with. An empty string is a folded row, and it costs
	// no rows at all, which is why the budget for the body starts two lines lower.
	const marker = isCursor ? CURSOR_MARKER : "";
	const fullHeader = headerTextFor(message, previous, clock, marker);
	// The suffix is one string for measurement and render: `headerLine` composes exactly
	// clock + space + author + suffix, so a marker cannot be counted and not drawn.
	const suffix = headerSuffix(message);
	const header =
		fullHeader === "" ? { text: "", rows: 0 } : textForDisplay(fullHeader, rowBudget, innerWidth);
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

	// The bar is one element reused on every line of this message. A run of messages you sent is
	// then a solid line down the pane, which is the whole point of drawing it.
	const bar = message.isOutgoing ? (
		<Text color="green">{OWN_GUTTER}</Text>
	) : (
		<Text>{PEER_GUTTER}</Text>
	);
	// `exactOptionalPropertyTypes` refuses `color={undefined}`, and "no colour" is not "white": the
	// default foreground is what a peer's name should keep, whichever theme the terminal has.
	const author = message.isOutgoing ? (
		<Text bold color="green">
			{describeAuthor(message)}
		</Text>
	) : (
		<Text bold>{describeAuthor(message)}</Text>
	);

	return (
		<Box flexDirection="column">
			{header.rows === 0 ? null : header.text === fullHeader ? (
				<Text>
					{bar}
					{marker === "" ? null : <Text color="cyan">{marker}</Text>}
					<Text dimColor>{clock(message.sentAt)} </Text>
					{author}
					{suffix === "" ? null : <Text dimColor>{suffix}</Text>}
				</Text>
			) : (
				<Text>
					{bar}
					{header.text}
				</Text>
			)}
			{quoteRows > 0 ? (
				<Text dimColor>
					{bar}
					{quote.text}
				</Text>
			) : null}
			{showsBody(message) && body.rows > 0
				? linesOf(body.text).map((line, index) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: a wrapped body is replaced as a set on every render, so a position is a stable key here
						<Text key={`${message.id}:body:${index}`} dimColor={message.isDeleted}>
							{bar}
							{line}
						</Text>
					))
				: null}
			{files.lines.map((line, index) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: files render in the order signal-cli listed them and are replaced as a set, so a position is a stable key here
				<Text key={`${message.id}:${index}`} dimColor>
					{bar}
					{line}
				</Text>
			))}
			{/* Only when a row was actually reserved: with no budget left the marker would push
			    the title or the "older" label out of the pane. */}
			{files.omitted > 0 && files.rows > 0 ? (
				<Text dimColor>
					{bar}… +{files.omitted} more {files.omitted === 1 ? "file" : "files"}
				</Text>
			) : null}
		</Box>
	);
}
