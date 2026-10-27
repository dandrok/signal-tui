import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
	findBarrelBypasses,
	findCycles,
	findOverBudget,
	findSiblingUsecaseImports,
	lineCount,
	loadModules,
	type SourceModule,
	specifiersOf,
} from "./helpers/architecture-rules";

/**
 * The architecture, as a test.
 *
 * Layering is already handled by Biome's `noRestrictedImports` zones (domain cannot reach
 * for a framework, `ui` cannot reach for an adapter, `app` cannot reach for either). What a
 * linter cannot see is the *shape* of the graph and the size of a file, and those are the
 * two things this repo drifts on: one god-file per layer, and a cycle created by a split
 * done for line count.
 *
 * The rules live in `helpers/architecture-rules.ts` as pure functions so each one is run
 * against a graph that violates it. Asserting only against the real tree proves nothing:
 * the tree happens not to contain the violation today, so the test passes whether or not
 * the detector works.
 */

const ROOT = resolve(import.meta.dir, "..");
const modules = loadModules(ROOT);

/** Just enough of `biome.json` to pin the rule and its one exemption. */
interface BiomeConfig {
	readonly linter: {
		readonly rules: {
			readonly style: {
				readonly noExcessiveLinesPerFile: unknown;
			};
		};
	};
	readonly overrides?: readonly {
		readonly includes: readonly string[];
		readonly linter?: {
			readonly rules?: { readonly style?: { readonly noExcessiveLinesPerFile?: unknown } };
		};
	}[];
}

/** A module graph from `path → imports`, for the violating shapes below. */
const graph = (sources: Record<string, readonly string[]>): SourceModule[] =>
	Object.entries(sources).map(([path, imports]) => ({ path, lines: 10, imports }));

describe("reading imports", () => {
	test("sees an import whose specifiers span several lines", () => {
		// The form this repo actually uses. A line-bounded pattern drops most of the graph,
		// which is how the first version of this guard missed a three-file cycle.
		expect(specifiersOf('import {\n\treadonly a,\n\treadonly b,\n} from "./multi";')).toEqual([
			"./multi",
		]);
	});

	test("sees a side-effect import", () => {
		expect(specifiersOf('import "./register";')).toEqual(["./register"]);
	});

	test("sees a re-export, which is an edge too", () => {
		expect(specifiersOf('export { a } from "./barrel";')).toEqual(["./barrel"]);
	});

	test("ignores an import that only appears in a comment", () => {
		expect(specifiersOf('// import { a } from "./ghost";\n/* import "./ghost2"; */')).toEqual([]);
	});

	test("counts lines the way wc -l does", () => {
		expect(lineCount("a\nb\n")).toBe(2);
		expect(lineCount("a\nb")).toBe(2);
	});
});

describe("the rules fire on a violating graph", () => {
	test("finds a two-file cycle", () => {
		expect(findCycles(graph({ "src/a.ts": ["src/b.ts"], "src/b.ts": ["src/a.ts"] }))).toEqual([
			["src/a.ts", "src/b.ts"],
		]);
	});

	test("finds the three-file cycle this repo actually had", () => {
		// The real shape, kept as the fixture: the reducer, the history page and the
		// conversation selectors each imported the next, until the split moved their shared
		// vocabulary into `state/types.ts`. A detector that only ever sees two-file cycles is
		// not the detector this repo needed.
		const cyclic = graph({
			"src/app/state/state.ts": ["src/app/state/reduce-history.ts"],
			"src/app/state/reduce-history.ts": ["src/app/state/selectors.ts"],
			"src/app/state/selectors.ts": ["src/app/state/state.ts"],
		});

		expect(findCycles(cyclic)).toHaveLength(1);
	});

	test("a chain is not a cycle", () => {
		expect(findCycles(graph({ "src/a.ts": ["src/b.ts"], "src/b.ts": ["src/c.ts"] }))).toEqual([]);
	});

	test("finds an import that bypasses a folder's barrel", () => {
		const bypass = graph({
			"src/rows/index.ts": ["src/rows/inner.ts"],
			"src/rows/inner.ts": [],
			"src/ui/Pane.tsx": ["src/rows/inner.ts"],
		});

		expect(findBarrelBypasses(bypass)).toEqual([
			"src/ui/Pane.tsx → src/rows/inner.ts (use src/rows/index.ts)",
		]);
	});

	test("lets a file inside the folder use its neighbour directly", () => {
		const inside = graph({
			"src/rows/index.ts": ["src/rows/inner.ts"],
			"src/rows/inner.ts": ["src/rows/other.ts"],
			"src/rows/other.ts": [],
		});

		expect(findBarrelBypasses(inside)).toEqual([]);
	});

	test("finds a use case reaching into a sibling slice, folders included", () => {
		const siblings = graph({
			"src/app/usecases/react/index.ts": ["src/app/usecases/edit/x.ts"],
			"src/app/usecases/edit/x.ts": [],
		});

		expect(findSiblingUsecaseImports(siblings)).toEqual([
			"src/app/usecases/react/index.ts → src/app/usecases/edit/x.ts",
		]);
	});

	test("lets a slice use its own files, and the barrel list the slices", () => {
		const fine = graph({
			"src/app/usecases/index.ts": [
				"src/app/usecases/react/index.ts",
				"src/app/usecases/edit/index.ts",
			],
			"src/app/usecases/react/index.ts": ["src/app/usecases/react/a.ts"],
			"src/app/usecases/react/a.ts": [],
			"src/app/usecases/edit/index.ts": [],
		});

		expect(findSiblingUsecaseImports(fine)).toEqual([]);
	});

	test("finds a file over the default budget", () => {
		const big = [{ path: "src/big.ts", lines: 201, imports: [] as string[] }];

		expect(findOverBudget(big, {}).map((entry) => entry.path)).toEqual(["src/big.ts"]);
	});

	test("a file exactly at the limit is not over it", () => {
		// The boundary is where an off-by-one hides, and it is the number every file here
		// sits near after a split.
		const edge = [{ path: "src/edge.ts", lines: 200, imports: [] as string[] }];

		expect(findOverBudget(edge, {})).toEqual([]);
	});
});

describe("this tree", () => {
	test("has no import cycle at all", () => {
		// The three-file cycle this rule was seeded with (conversations → state → history) is
		// gone: the reducer split moved the shared vocabulary into `state/types.ts`, so the
		// conversation selectors no longer reach back through the reducer. The allowlist is
		// empty on purpose — a cycle has no reason to exist here.
		expect(findCycles(modules)).toEqual([]);
	});

	test("keeps the 200-line rule at error level, and exempts only tests", () => {
		// The rule above is half the claim. The other half is that `bun run verify` fails on a
		// long file *before* this test runs — which is only true while biome holds the same
		// number at error level, and while no override quietly exempts a source folder.
		const config = JSON.parse(readFileSync(join(ROOT, "biome.json"), "utf8")) as BiomeConfig;
		expect(config.linter.rules.style.noExcessiveLinesPerFile).toEqual({
			level: "error",
			options: { maxLines: 200 },
		});
		const exemptions = (config.overrides ?? [])
			.filter((entry) => entry.linter?.rules?.style?.noExcessiveLinesPerFile !== undefined)
			.map((entry) => entry.includes);
		expect(exemptions).toEqual([["tests/**"]]);
	});

	test("has no file over 200 lines", () => {
		// A hard cap, not a ratchet: the tree reached zero exceptions in step 4, so there is
		// no budget file left to hold one. A file that grows past 200 has to be split, and
		// the failure below names it with both numbers.
		expect(
			findOverBudget(modules, {}).map((entry) => `${entry.path}: ${entry.lines} lines`),
		).toEqual([]);
	});

	test("enters a folder that publishes a barrel through the barrel", () => {
		expect(findBarrelBypasses(modules)).toEqual([]);
	});

	test("keeps every use case out of its siblings", () => {
		expect(findSiblingUsecaseImports(modules)).toEqual([]);
	});

	test("was actually read, so a green run means something", () => {
		// Guards the guards: a walk that silently returned nothing would make every
		// assertion above vacuously true.
		expect(modules.length).toBeGreaterThan(50);
		expect(modules.some((module) => module.path === "src/cli.tsx")).toBe(true);
	});
});
