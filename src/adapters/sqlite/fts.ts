/**
 * Turns free text into a safe FTS5 query: each word becomes a quoted prefix term,
 * so `AND`, `NOT`, `NEAR(`, `*` and unbalanced quotes from a user (or from a
 * message body) can never reach the query parser.
 */
export function toFtsQuery(input: string): string | null {
	const tokens = input
		.toLowerCase()
		.split(/[^\p{L}\p{N}_]+/u)
		.filter((token) => token.length > 0);

	if (tokens.length === 0) {
		return null;
	}

	return tokens.map((token) => `"${token.replaceAll('"', '""')}"*`).join(" ");
}
