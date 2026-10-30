/**
 * The colour a peer's name is drawn in.
 *
 * In a direct chat it is one colour, which is enough to say "this is not you". In a group it is
 * the only thing that separates five people whose messages are otherwise identical rows, so it is
 * derived from the sender — the same person keeps their colour across restarts, and their colour
 * does not depend on who else is in the thread.
 *
 * Picked from a short palette rather than generated: a terminal has sixteen colours and most of
 * them are unreadable on one background or the other. These four are the ones that survive both.
 */

const PALETTE = ["cyan", "magenta", "yellow", "blue"] as const;

/**
 * Stable palette entry for a sender.
 *
 * `authorId` is the key, because that is what Signal uses to say who sent a message; the display
 * label is the fallback for rows cached before it was stored. The hash is deliberately small and
 * boring — it only has to spread a handful of ids over four slots, and a caller may rely on it
 * being the same on every render.
 */
export function authorColour(authorId: string | undefined, label: string): string {
	const key = authorId ?? label;
	let hash = 0;
	for (const character of key) {
		hash = (hash * 31 + (character.codePointAt(0) ?? 0)) | 0;
	}
	return PALETTE[Math.abs(hash) % PALETTE.length] ?? "cyan";
}
