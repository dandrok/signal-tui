import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// README.md is the registry landing page: npm publishes the file as it stood at the tagged
// commit, so a version typed into its prose is a claim that goes stale on the next release —
// 0.6.1 was still advertised as the status when the published package was 0.7.1. The number
// lives in package.json and CHANGELOG.md; the pages point at them instead.
const PAGES = ["README.md", "SETUP.md"];

/** Report every line of a shipped page that states a version as a status. */
function statusVersions(page: string): string[] {
	const text = readFileSync(new URL(`../${page}`, import.meta.url), "utf8");
	return text
		.split("\n")
		.map((line, index) => ({ line, number: index + 1 }))
		.filter(({ line }) => /status:\s*`?\d+\.\d+\.\d+`?/i.test(line))
		.map(({ line, number }) => `${page}:${number}: ${line.trim()}`);
}

test("a shipped page never states this package's version", () => {
	expect(PAGES.flatMap(statusVersions)).toEqual([]);
});
