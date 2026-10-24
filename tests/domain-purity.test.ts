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
		.map((file) => ({ file, source: readFileSync(`src/domain/${file}`, "utf8") }));

describe("domain purity", () => {
	test("no host-clock reads: timestamps are formatted from an injected clock", () => {
		// A helper that calls getHours() renders differently on every machine and
		// cannot be tested; the zone is a parameter supplied by the UI layer.
		const offenders = domainSources().filter(({ source }) =>
			/(getHours|getMinutes|toLocaleTimeString)/.test(source),
		);
		expect(offenders.map(({ file }) => file)).toEqual([]);
	});

	test("no Intl formatter cached in the domain", () => {
		// The per-zone formatter cache is mutable module state: it lives in src/ui.
		const offenders = domainSources().filter(({ source }) => source.includes("Intl."));
		expect(offenders.map(({ file }) => file)).toEqual([]);
	});
});
