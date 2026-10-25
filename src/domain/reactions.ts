import { displayLine } from "./display";
import type { Message, Reaction } from "./types";

/**
 * How many distinct emojis a header shows before it says "…". A peer can react with
 * anything, and a header that grows without bound would take the rows the message
 * window budgeted for the message itself.
 */
const MAX_MARKERS = 6;

/**
 * Longest emoji drawn. Signal sends one grapheme; a payload carrying a paragraph
 * would otherwise become the header, so it is cut and the rest is not shown.
 */
const MAX_EMOJI_LENGTH = 8;

/** Reactions on a message, without every caller repeating `?? []`. */
export function reactionsOf(message: Message): readonly Reaction[] {
	return message.reactions ?? [];
}

/**
 * The reaction suffix for a message header: `😀 2 ❤️`, most-reacted first, then by
 * emoji so two stores that saw the same reactions in different order draw the same
 * row. Counted per emoji rather than per person: the header is one line, and who
 * reacted belongs on a detail view we do not have yet.
 *
 * The emoji is remote text — sanitised and length-capped here, at the display
 * boundary, exactly like a body or an author name.
 */
export function reactionMarker(message: Message): string {
	const counts = new Map<string, number>();
	for (const reaction of reactionsOf(message)) {
		const emoji = displayLine(reaction.emoji).slice(0, MAX_EMOJI_LENGTH);
		if (emoji.length === 0) {
			continue;
		}
		counts.set(emoji, (counts.get(emoji) ?? 0) + 1);
	}
	if (counts.size === 0) {
		return "";
	}

	const ranked = [...counts.entries()].sort(
		([leftEmoji, leftCount], [rightEmoji, rightCount]) =>
			rightCount - leftCount || leftEmoji.localeCompare(rightEmoji),
	);
	const parts = ranked
		.slice(0, MAX_MARKERS)
		.map(([emoji, count]) => (count > 1 ? `${emoji} ${count}` : emoji));
	if (ranked.length > MAX_MARKERS) {
		parts.push("…");
	}
	return ` ${parts.join(" ")}`;
}
