import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// README.md is the registry landing page: npm publishes the file as it stood at the tagged
// commit, so a version typed into its prose is a claim that goes stale on the next release —
// 0.6.1 was still advertised as the status when the published package was 0.7.1. The number
// lives in package.json and CHANGELOG.md; the pages point at them instead.
const PAGES = ["README.md", "SETUP.md"];

/**
 * Report every line that states a version as a status, in any shape prose wears it:
 * `Status: 1.2.3`, `Status: **1.2.3**`, `**Status:** 1.2.3`, `Status: v1.2.3`. Emphasis between
 * the label and the number is allowed for, because bolding the label is the form that slips past a
 * whitespace-only gap; the `v` is the shape the tag itself wears, which is how a release is named.
 */
function statusVersionsIn(text: string): string[] {
	return text
		.split("\n")
		.map((line, index) => ({ line, number: index + 1 }))
		.filter(({ line }) => /status:\s*(?:[*_~`]{1,3}\s*)*v?\d+\.\d+\.\d+/i.test(line))
		.map(({ line, number }) => `${number}: ${line.trim()}`);
}

test("a shipped page never states this package's version", () => {
	const offenders = PAGES.flatMap((page) =>
		statusVersionsIn(readFileSync(new URL(`../${page}`, import.meta.url), "utf8")).map(
			(line) => `${page}:${line}`,
		),
	);
	expect(offenders).toEqual([]);
});

test("the ban sees through the emphasis a status label can wear", () => {
	const banned = [
		"Status: 0.8.0",
		"Status: `0.8.0`",
		"Status: **0.8.0**",
		"**Status:** 0.8.0",
		"**Status:** `0.8.0` — a full-screen client",
		"Status: v0.8.0",
		"**Status:** v0.8.0 — the tag's own shape",
	];
	for (const line of banned) expect(statusVersionsIn(line)).toHaveLength(1);

	// A version the page may name because it is not ours stays allowed.
	const allowed = ["Below `0.14.9` is a failure", "settled status: unchanged"];
	for (const line of allowed) expect(statusVersionsIn(line)).toEqual([]);
});
