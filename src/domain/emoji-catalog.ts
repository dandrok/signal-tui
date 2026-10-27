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
	// "red heart" does, so both the query and the names are compared with them removed.
	const compact = needle.replace(/\s+/g, "");
	const scored: Array<{ entry: EmojiEntry; score: number }> = [];
	for (const entry of EMOJI_CATALOG) {
		let best = Number.POSITIVE_INFINITY;
		for (const name of entry.names) {
			const tight = name.replace(/\s+/g, "");
			if (name === needle || tight === compact) {
				best = Math.min(best, 0);
			} else if (name.startsWith(needle) || tight.startsWith(compact)) {
				best = Math.min(best, 1);
			} else if (name.includes(needle) || tight.includes(compact)) {
				best = Math.min(best, 2);
			}
		}
		if (Number.isFinite(best)) {
			scored.push({ entry, score: best });
		}
	}
	return scored
		.sort((left, right) => left.score - right.score)
		.slice(0, limit)
		.map((scoredEntry) => scoredEntry.entry);
}
