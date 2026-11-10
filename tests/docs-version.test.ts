import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// README.md is the registry landing page: npm publishes the file as it stood at the tagged
// commit, so a version typed into its prose is a claim that goes stale on the next release —
// 0.6.1 was still advertised as the status when the published package was 0.7.1. The number
// lives in package.json and CHANGELOG.md; the pages point at them instead.
const PAGES = ["README.md", "SETUP.md"];

/**
 * Report every line that both carries a status label and names a version. The rule is stated
 * as that invariant rather than as a pattern for the gap between the two, because the gap is
 * whatever the writer typed: emphasis (`**Status:** 0.8.0`), a tag prefix (`Status: v0.8.0`),
 * a maturity with the number in brackets (`Status: pre-1.0 (0.8.0)`). A line may say which
 * state the project is in, or name a version; naming this package's version is what the page
 * does not do, in any spelling, so no gap has to be enumerated.
 */
function statusVersionsIn(text: string): string[] {
	return text
		.split("\n")
		.map((line, index) => ({ line, number: index + 1 }))
		.filter(({ line }) => /status:/i.test(line) && /v?\d+\.\d+\.\d+/.test(line))
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

test("a status line names no version, however the two are written together", () => {
	const banned = [
		"Status: 0.8.0",
		"Status: `0.8.0`",
		"Status: **0.8.0**",
		"**Status:** 0.8.0",
		"**Status:** `0.8.0` — a full-screen client",
		"Status: v0.8.0",
		"**Status:** v0.8.0 — the tag's own shape",
		"Status: pre-1.0 (0.8.0)",
		"Status: pre-1.0 — shipped as 0.8.0, moves files both ways",
	];
	for (const line of banned) expect(statusVersionsIn(line)).toHaveLength(1);

	// A version the page may name because it is not ours stays allowed, and so does a status
	// label on its own — the ban is the conjunction of the two, nothing more.
	const allowed = [
		"Below `0.14.9` is a failure",
		"`signal-cli` 0.14.9 is the floor",
		"settled status: unchanged",
	];
	for (const line of allowed) expect(statusVersionsIn(line)).toEqual([]);
});
