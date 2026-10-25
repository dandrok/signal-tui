/**
 * First `max` grapheme clusters of `text`, never splitting one.
 *
 * Cutting by UTF-16 code unit is wrong twice over for an emoji: `"👨‍👩‍👧‍👦".slice(0, 8)`
 * answers `"👨‍👩‍👧"` — a different emoji — and a cut in the middle of a surrogate pair
 * leaves half a character. Grapheme clusters are what a reader counts as one symbol.
 *
 * This is the one `Intl` use the domain allows, and the purity test says so explicitly:
 * unlike `Intl.DateTimeFormat`, grapheme boundaries are locale-independent (UAX #29), so
 * the host's timezone and locale cannot change the answer, and the object carries no
 * per-zone cache to go stale.
 */
const SEGMENTER = new Intl.Segmenter("en", { granularity: "grapheme" });

export function firstGraphemes(text: string, max: number): string {
	if (max <= 0) {
		return "";
	}
	// A grapheme is at least one code unit, so a string no longer than the cap cannot
	// exceed it: skip the segmentation for the common case (one emoji, one or two units).
	if (text.length <= max) {
		return text;
	}

	let kept = "";
	let count = 0;
	for (const { segment } of SEGMENTER.segment(text)) {
		if (count === max) {
			break;
		}
		kept += segment;
		count += 1;
	}
	return kept;
}
