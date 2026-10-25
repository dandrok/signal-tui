import { displayEmoji } from "./display";
import { firstGraphemes } from "./graphemes";
import type { Message, Reaction } from "./types";

/**
 * How many distinct emojis a header shows before it says "…". A peer can react with
 * anything, and a header that grows without bound would take the rows the message
 * window budgeted for the message itself.
 */
const MAX_MARKERS = 6;

/**
 * Longest emoji drawn, in grapheme clusters. Signal sends one; a payload carrying a
 * paragraph would otherwise become the header, so it is cut and the rest is not shown.
 * Counted in clusters, not code units: an eight-unit cut lands inside a ZWJ sequence
 * and draws a different emoji (`👨‍👩‍👧‍👦` is eleven units, one symbol).
 */
const MAX_EMOJI_GRAPHEMES = 8;

/**
 * Longest emoji kept, in UTF-16 units, checked before the grapheme cut. The two bounds
 * catch different things: a cluster count alone bounds nothing, because a base character
 * followed by ten thousand combining marks is **one** cluster — eight clusters can be a
 * ten-kilobyte string that the pane then re-wraps on every frame. A real emoji is short
 * (four people with skin tones is nineteen units), so a longer value is not an emoji and
 * is dropped rather than shown.
 */
const MAX_EMOJI_CODE_UNITS = 32;

/** Reactions on a message, without every caller repeating `?? []`. */
export function reactionsOf(message: Message): readonly Reaction[] {
	return message.reactions ?? [];
}

/**
 * The reaction suffix for a message header: `😀 2 ❤️`, most-reacted first, then in a
 * fixed order so two hosts draw the same row for the same reactions. Counted per emoji
 * rather than per person: the header is one line, and who reacted belongs on a detail
 * view we do not have yet.
 *
 * The emoji is remote text — sanitised here and bounded both by cluster count and by
 * length, at the display boundary, exactly like a body or an author name.
 */
export function reactionMarker(message: Message): string {
	const counts = new Map<string, number>();
	for (const reaction of reactionsOf(message)) {
		const raw = displayEmoji(reaction.emoji);
		if (raw.length === 0 || raw.length > MAX_EMOJI_CODE_UNITS) {
			continue;
		}
		const emoji = firstGraphemes(raw, MAX_EMOJI_GRAPHEMES);
		counts.set(emoji, (counts.get(emoji) ?? 0) + 1);
	}
	if (counts.size === 0) {
		return "";
	}

	// Code-unit order, not `localeCompare`: that call without a locale resolves the runtime's
	// *default* locale, which is host state, so the same reactions would draw in a different
	// order on a machine with a different ICU default. Ties are broken deterministically.
	const ranked = [...counts.entries()].sort(
		([leftEmoji, leftCount], [rightEmoji, rightCount]) =>
			rightCount - leftCount || (leftEmoji < rightEmoji ? -1 : leftEmoji > rightEmoji ? 1 : 0),
	);
	const parts = ranked
		.slice(0, MAX_MARKERS)
		.map(([emoji, count]) => (count > 1 ? `${emoji} ${count}` : emoji));
	if (ranked.length > MAX_MARKERS) {
		parts.push("…");
	}
	return ` ${parts.join(" ")}`;
}
