import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";

/**
 * The layering rules a type checker cannot see. `biome.json` forbids importing
 * adapters, ink and react from `src/domain`; these two are about what the domain
 * computes rather than what it imports.
 */
const domainSources = (): readonly { readonly file: string; readonly source: string }[] =>
	readdirSync("src/domain")
		.filter((file) => file.endsWith(".ts"))
		// Block comments are prose: a file may legitimately explain which API the rule
		// forbids, and matching that would fail the suite for documentation.
		.map((file) => ({
			file,
			source: readFileSync(`src/domain/${file}`, "utf8").replace(/\/\*[\s\S]*?\*\//g, ""),
		}));

describe("domain purity", () => {
	test("no host-clock reads: timestamps are formatted from an injected clock", () => {
		// A helper that calls getHours() renders differently on every machine and
		// cannot be tested; the zone is a parameter supplied by the UI layer.
		const offenders = domainSources().filter(({ source }) =>
			/(getHours|getMinutes|toLocaleTimeString)/.test(source),
		);
		expect(offenders.map(({ file }) => file)).toEqual([]);
	});

	test("no locale- or zone-dependent formatting in the domain", () => {
		// The rule is about output that depends on the host: a per-zone formatter cache is
		// mutable module state and renders differently on every machine, so both it and the
		// locale-dependent formatters live in src/ui. `Intl.Segmenter` is not that: grapheme
		// boundaries are defined by UAX #29, not by the host's locale or timezone, and
		// `domain/graphemes.ts` needs them to cut an emoji without splitting it.
		const offenders = domainSources().filter(({ source }) =>
			/(Intl\.DateTimeFormat|Intl\.NumberFormat|Intl\.Collator|toLocaleString|toLocaleDateString|toLocaleTimeString)/.test(
				source,
			),
		);
		expect(offenders.map(({ file }) => file)).toEqual([]);
	});
});
