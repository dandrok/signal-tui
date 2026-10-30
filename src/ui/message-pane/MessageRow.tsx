import { Box, Text } from "ink";
import type { Clock } from "../../domain/format";
import { describeAuthor, headerSuffix, showsBody } from "../../domain/format";
import {
	attachmentsForDisplay,
	bodyForDisplay,
	dayDividerLine,
	headerTextFor,
	type QuoteLookup,
	quoteForDisplay,
	separatorFor,
	separatorRows,
	textForDisplay,
	wrapToWidth,
} from "../../domain/rows";
import type { Message } from "../../domain/types";
import { authorColour } from "./author-colour";
import { CURSOR_MARKER } from "./window";

/**
 * Two columns to the left of every message: a bar, and the space after it.
 *
 * Both sides get one, in different weights — a half block for yours, a quarter block for theirs.
 * Marking only your own messages left the other side looking like unformatted text: the reader
 * could see which rows were theirs but not that the rest were somebody's. The weights also
 * survive a monochrome terminal, where colour is not available to tell them apart.
 */
export const GUTTER_WIDTH = 2;

const OWN_GUTTER = "▌ ";
const PEER_GUTTER = "▎ ";

/** One entry per drawn row, so a body that wrapped still gets a bar on every line. */
const linesOf = (text: string): readonly string[] => text.split("\n");

/**
 * One message, measured against a shared row budget.
 *
 * The order is deliberate: the separator above it (a date divider or a blank line), then the
 * header — unless this message continues the block above — then what it quotes, then the files,
 * and the body gets whatever is left. So neither a long name nor a long body can hide a peer's
 * filenames, and the rows this draws are the rows `messageOverheadRows` counted.
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
	/** The message above it, which decides whether this row repeats the author, and whether a
	 *  day divider or a blank line belongs above it. */
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
	const separator = separatorFor(previous, message, clock);
	const separatorRowsAbove = separatorRows(separator);
	// Same budget arithmetic as `messageOverheadRows`, which is what fitted the window:
	// separator, header, then the quote, then the files, and the body takes the rest.
	// `quoteForDisplay` has already bounded itself to one row at this width, so the budget can
	// only drop it.
	const remaining = Math.max(0, rowBudget - separatorRowsAbove - header.rows);
	const quote = quoteForDisplay(message, innerWidth, clock, lookup);
	const quoteRows = Math.min(quote.rows, remaining);
	const files = attachmentsForDisplay(message, Math.max(0, remaining - quoteRows), innerWidth);
	const body = bodyForDisplay(message, Math.max(0, remaining - quoteRows - files.rows), innerWidth);

	// The bar is one element reused on every line of this message. A run of messages you sent is
	// then a solid line down the pane, which is the whole point of drawing it.
	const bar = message.isOutgoing ? (
		<Text color="green">{OWN_GUTTER}</Text>
	) : (
		<Text color="gray">{PEER_GUTTER}</Text>
	);
	// `exactOptionalPropertyTypes` refuses `color={undefined}`, and "no colour" is not "white": the
	// default foreground is what a peer's name used to keep. It is now the one thing that says
	// *which* person this is, so it is derived from the sender rather than left to the theme.
	const author = message.isOutgoing ? (
		<Text bold color="green">
			{describeAuthor(message)}
		</Text>
	) : (
		<Text bold color={authorColour(message.authorId, describeAuthor(message))}>
			{describeAuthor(message)}
		</Text>
	);

	return (
		<Box flexDirection="column">
			{separator.kind === "day" ? (
				<Text dimColor>{dayDividerLine(separator.label, innerWidth)}</Text>
			) : null}
			{header.rows === 0 ? null : header.text === fullHeader ? (
				<Text>
					{bar}
					{marker === "" ? null : <Text color="cyan">{marker}</Text>}
					<Text dimColor>{clock.time(message.sentAt)} </Text>
					{author}
					{suffix === "" ? null : <Text dimColor>{suffix}</Text>}
				</Text>
			) : (
				// A header long enough to be cut can still come back as more than one row — six
				// reaction markers at the narrowest pane will do it — and a bar before only the first
				// of them leaves the rest looking like the other side's.
				linesOf(header.text).map((line, index) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: header rows are replaced as a set on every render, so a position is a stable key here
					<Text key={`${message.id}:header:${index}`}>
						{bar}
						{line}
					</Text>
				))
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
			{files.lines.flatMap((line, index) =>
				// A filename long enough to wrap is drawn as the rows it occupies, not as one string
				// ink wraps behind our back: `messageOverheadRows` counted those rows already, and a
				// bar on the first of them only is how a wrapped file looks unmarked.
				wrapToWidth(line, innerWidth).map((row, rowIndex) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: files render in the order signal-cli listed them and are replaced as a set, so a position is a stable key here
					<Text key={`${message.id}:${index}:${rowIndex}`} dimColor>
						{bar}
						{row}
					</Text>
				)),
			)}
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
