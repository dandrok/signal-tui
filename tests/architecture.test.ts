import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
	findBarrelBypasses,
	findCycles,
	findOverBudget,
	findSiblingUsecaseImports,
	findStaleBudgets,
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
const BUDGET_PATH = join(import.meta.dir, "fixtures", "architecture-budget.json");
const budget = JSON.parse(readFileSync(BUDGET_PATH, "utf8")) as Record<string, number>;
const modules = loadModules(ROOT);

/**
 * The one cycle that predates this rule: `conversations → state → history → conversations`,
 * created by splitting files out of the reducer for line count. Removing it is step 3 of the
 * refactor plan; adding another is what this test exists to prevent.
 */
const KNOWN_CYCLES: readonly (readonly string[])[] = [
	["src/app/conversations.ts", "src/app/history.ts", "src/app/state.ts"],
];

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

	test("finds a cycle that runs through a barrel", () => {
		const cyclic = graph({
			"src/app/state.ts": ["src/app/history.ts"],
			"src/app/history.ts": ["src/app/conversations.ts"],
			"src/app/conversations.ts": ["src/app/state.ts"],
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

	test("an entry that no longer matches its file is stale in both directions", () => {
		const shrunk = [{ path: "src/big.ts", lines: 220, imports: [] as string[] }];

		expect(findStaleBudgets(shrunk, { "src/big.ts": 324 })).toEqual([
			"src/big.ts: budget 324, file is 220",
		]);
		expect(findStaleBudgets(shrunk, { "src/big.ts": 220 })).toEqual([]);
	});

	test("an entry for a deleted file is stale", () => {
		expect(findStaleBudgets([], { "src/gone.ts": 300 })).toEqual([
			"src/gone.ts: entry for a file that does not exist",
		]);
	});
});

describe("this tree", () => {
	test("has no cycle outside the one the rule was seeded with", () => {
		const canonical = (component: readonly string[]): string => [...component].sort().join(" | ");
		const allowed = new Set(KNOWN_CYCLES.map(canonical));

		expect(
			findCycles(modules)
				.filter((c) => !allowed.has(canonical(c)))
				.map(canonical),
		).toEqual([]);
	});

	test("still has the seeded cycle, so the allowlist cannot go stale", () => {
		const canonical = (component: readonly string[]): string => [...component].sort().join(" | ");
		const present = new Set(findCycles(modules).map(canonical));

		expect(KNOWN_CYCLES.filter((c) => !present.has(canonical(c))).map(canonical)).toEqual([]);
	});

	test("has no file over its budget", () => {
		expect(
			findOverBudget(modules, budget).map((e) => `${e.path}: ${e.lines} > ${e.limit}`),
		).toEqual([]);
	});

	test("has a budget entry that matches every listed file exactly", () => {
		// Exact, not "at most": an entry above the file's size is slack it could grow back
		// into, which is the one thing a ratchet must not allow.
		expect(findStaleBudgets(modules, budget)).toEqual([]);
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
