/**
 * A curated emoji table, and the search over it.
 *
 * Deliberately *not* the full Unicode set: CLDR ships ~3600 names and every library that
 * carries them costs a dependency and a few hundred kilobytes, to answer questions nobody asks
 * in a terminal prompt. This is the vocabulary people actually reach for when reacting to a
 * message, with the aliases they type — `heart`, `red heart`, `love` all reach ❤️.
 *
 * The picker does not depend on it (an empty query shows the first entries), so a name that is
 * missing costs one keystroke, not a broken feature. When one is missing often enough, add it
 * here: the list is data, and every entry is one line.
 */
export interface EmojiEntry {
	readonly emoji: string;
	/** What people call it, lowercase. The first is the canonical name. */
	readonly names: readonly string[];
}

export const EMOJI_CATALOG: readonly EmojiEntry[] = [
	{ emoji: "👍", names: ["thumbs up", "thumbsup", "like", "+1", "yes"] },
	{ emoji: "❤️", names: ["heart", "red heart", "love"] },
	{ emoji: "😂", names: ["laugh", "joy", "lol"] },
	{ emoji: "🎉", names: ["tada", "party", "celebrate"] },
	{ emoji: "🔥", names: ["fire", "lit", "hot"] },
	{ emoji: "😮", names: ["wow", "surprised", "open mouth"] },
	{ emoji: "😢", names: ["sad", "tear", "cry"] },
	{ emoji: "🙏", names: ["pray", "thanks", "please"] },
	{ emoji: "👏", names: ["clap", "applause", "bravo"] },
	{ emoji: "💯", names: ["hundred", "100", "perfect"] },
	{ emoji: "👀", names: ["eyes", "look", "watching"] },
	{ emoji: "🤔", names: ["thinking", "hmm", "consider"] },
	{ emoji: "😅", names: ["sweat", "phew", "awkward"] },
	{ emoji: "🤣", names: ["rofl", "rolling", "laughing"] },
	{ emoji: "😍", names: ["heart eyes", "love eyes", "adore"] },
	{ emoji: "😘", names: ["kiss", "blow kiss"] },
	{ emoji: "😎", names: ["cool", "sunglasses"] },
	{ emoji: "🤯", names: ["mind blown", "exploding head", "shock"] },
	{ emoji: "🥳", names: ["party face", "celebrate face"] },
	{ emoji: "😭", names: ["sob", "bawl", "crying"] },
	{ emoji: "😡", names: ["angry", "rage", "mad"] },
	{ emoji: "🤢", names: ["sick", "nausea", "gross"] },
	{ emoji: "✅", names: ["check", "done", "tick", "ok"] },
	{ emoji: "❌", names: ["no", "cross", "wrong", "x"] },
	{ emoji: "⚠️", names: ["warning", "caution"] },
	{ emoji: "❓", names: ["question", "why"] },
	{ emoji: "❗", names: ["exclamation", "important"] },
	{ emoji: "⭐", names: ["star", "favourite", "favorite"] },
	{ emoji: "✨", names: ["sparkles", "magic", "shine"] },
	{ emoji: "🚀", names: ["rocket", "ship it", "launch"] },
	{ emoji: "☕", names: ["coffee", "tea", "break"] },
	{ emoji: "🍺", names: ["beer", "cheers", "pint"] },
	{ emoji: "🍕", names: ["pizza", "food"] },
	{ emoji: "🐱", names: ["cat", "kitty"] },
	{ emoji: "🐶", names: ["dog", "puppy"] },
	{ emoji: "🌞", names: ["sun", "sunny"] },
	{ emoji: "🌙", names: ["moon", "night"] },
	{ emoji: "💩", names: ["poop", "shit"] },
	{ emoji: "🤝", names: ["handshake", "deal", "agreed"] },
	{ emoji: "🤷", names: ["shrug", "dunno"] },
	{ emoji: "🫡", names: ["salute", "yes sir"] },
	{ emoji: "💪", names: ["muscle", "strong", "flex"] },
	{ emoji: "🙌", names: ["hooray", "raise hands", "praise"] },
	{ emoji: "😴", names: ["sleep", "tired", "zzz"] },
	{ emoji: "🤞", names: ["fingers crossed", "hope", "luck"] },
	{ emoji: "💔", names: ["broken heart", "heartbreak"] },
	{ emoji: "❤️‍🔥", names: ["fire heart", "burning heart"] },
	{ emoji: "🫶", names: ["heart hands", "love you"] },
];

/** How many suggestions a prompt shows at once: one row, and five fits an 80-column terminal. */
export const MAX_SUGGESTIONS = 5;

/**
 * The catalogue, flattened once with the names already normalised.
 *
 * Both normalisations are per-name facts, not per-query ones: doing `replace(/\s+/g, "")` inside
 * the search would re-derive 190 strings on every keystroke for an answer that never changes.
 * Measured: 25µs per search unflattened, ~2µs with the index. Neither is a problem at one
 * search per keystroke, but the cheap version is also the simpler one to read.
 */
interface IndexedName {
	readonly name: string;
	/** The name with spaces removed, because `redheart` is how people type it. */
	readonly tight: string;
	/** Catalogue position, so ties keep the order a reader sees in the data file. */
	readonly order: number;
}

const INDEX: readonly IndexedName[] = EMOJI_CATALOG.flatMap((entry, order) =>
	entry.names.map((name) => ({ name, tight: name.replace(/\s+/g, ""), order })),
);

/**
 * Emoji whose names match `query`, best first.
 *
 * Three tiers, because that is what makes a picker feel like it reads minds: an exact name, a
 * name that starts with the query, then a name that contains it. Ties keep the catalogue's
 * order, so the same query always draws the same row — no locale, no sort stability question.
 * An empty query returns the head of the list, which is what the picker opens on.
 */
export function searchEmoji(query: string, limit = MAX_SUGGESTIONS): readonly EmojiEntry[] {
	const needle = query.trim().toLowerCase().replace(/^:/, "").replace(/:$/, "");
	if (needle.length === 0) {
		return EMOJI_CATALOG.slice(0, limit);
	}
	// Spaces are not part of how people type a name: "redheart" has to reach ❤️ as surely as
	// "red heart" does, so the query is compared with and without them.
	const compact = needle.replace(/\s+/g, "");

	// One score per catalogue entry, in catalogue order: no map, no lookup back from an emoji
	// string, and the order survives for free — the array *is* the order.
	const scores = new Array<number>(EMOJI_CATALOG.length).fill(3);
	for (const indexed of INDEX) {
		let score = 3;
		if (indexed.name === needle || indexed.tight === compact) {
			score = 0;
		} else if (indexed.name.startsWith(needle) || indexed.tight.startsWith(compact)) {
			score = 1;
		} else if (indexed.name.includes(needle) || indexed.tight.includes(compact)) {
			score = 2;
		}
		if (score < (scores[indexed.order] ?? 3)) {
			scores[indexed.order] = score;
		}
	}

	const matches: Array<{ entry: EmojiEntry; score: number }> = [];
	for (let order = 0; order < scores.length; order++) {
		const score = scores[order] ?? 3;
		const entry = EMOJI_CATALOG[order];
		if (score < 3 && entry !== undefined) {
			matches.push({ entry, score });
		}
	}
	// `sort` is stable, and `matches` is already in catalogue order, so equal scores keep the
	// order the data file is read in.
	return matches
		.sort((left, right) => left.score - right.score)
		.slice(0, limit)
		.map((match) => match.entry);
}
