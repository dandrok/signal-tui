/** A parsed `x.y.z`, and the minimums this build is allowed to run against. */
export type Version = readonly [number, number, number];

export const MINIMUM_BUN: Version = [1, 4, 3];
export const MINIMUM_SIGNAL_CLI: Version = [0, 14, 0];
export const MINIMUM_JAVA: Version = [25, 0, 0];

/**
 * The signal-cli release this build's JSON-RPC use was actually read against.
 *
 * A floor is not enough for this engine. Signal moves, signal-cli follows, and releases older
 * than about three months stop working — so "newer than 0.14.0" can be true, runnable, and about
 * to fail on the next protocol change. This is the version whose commands and flags were checked,
 * which is a different and more useful fact than the minimum: an older one is a warning worth
 * reading, a newer one is untested but plausible.
 */
export const VERIFIED_SIGNAL_CLI: Version = [0, 14, 9];

/** First `x.y.z` in the text, or null — `java -version` prints its banner on stderr. */
export function parseVersion(text: string | null): Version | null {
	if (text === null) {
		return null;
	}
	const match = text.match(/(\d+)\.(\d+)\.(\d+)/);
	if (match === null) {
		return null;
	}
	return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** -1, 0 or 1 — how `version` sits against `reference`. */
export function compareVersions(version: Version, reference: Version): number {
	for (let index = 0; index < 3; index++) {
		const actual = version[index] ?? 0;
		const expected = reference[index] ?? 0;
		if (actual !== expected) {
			return actual > expected ? 1 : -1;
		}
	}
	return 0;
}

export function atLeast(version: Version | null, minimum: Version): boolean {
	return version === null ? false : compareVersions(version, minimum) >= 0;
}
