/** A parsed `x.y.z`, and the minimums this build is allowed to run against. */
export type Version = readonly [number, number, number];

export const MINIMUM_BUN: Version = [1, 4, 3];
export const MINIMUM_SIGNAL_CLI: Version = [0, 14, 0];
export const MINIMUM_JAVA: Version = [25, 0, 0];

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

export function atLeast(version: Version | null, minimum: Version): boolean {
	if (version === null) {
		return false;
	}
	for (let index = 0; index < 3; index++) {
		const actual = version[index] ?? 0;
		const required = minimum[index] ?? 0;
		if (actual !== required) {
			return actual > required;
		}
	}
	return true;
}
