import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

/**
 * The architecture, as a test.
 *
 * Layering is already handled by Biome's `noRestrictedImports` zones (domain cannot reach
 * for a framework, `ui` cannot reach for an adapter). What a linter cannot see is the
 * shape of the graph and the size of a file, and those are the two things this repo
 * actually drifts on: one god-file per layer, and a cycle created by a split done for line
 * count. Both are checked here so a refactor regresses a test instead of a reviewer.
 *
 * The line limit is a **ratchet**: files that are over the limit today are listed in
 * `fixtures/architecture-budget.json` with their current size, and may only shrink. New
 * files get the default. Delete an entry when a split lands; the file must not grow.
 */

const ROOT = resolve(import.meta.dir, "..");
const SRC = join(ROOT, "src");
/** Files allowed to be larger than the default until the refactor reaches them. */
const BUDGET_PATH = join(import.meta.dir, "fixtures", "architecture-budget.json");
const DEFAULT_MAX_LINES = 200;

/**
 * The one cycle that predates this rule, created by splitting `conversations.ts` out of
 * `state.ts` for line count. Removing it is step 3 of the refactor plan; adding another
 * is what this test exists to prevent.
 */
const KNOWN_CYCLES: readonly string[][] = [["src/app/conversations.ts", "src/app/state.ts"]];

const walk = (dir: string): string[] =>
	readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			return walk(path);
		}
		return entry.isFile() && /\.tsx?$/.test(entry.name) ? [path] : [];
	});

const toRepoPath = (absolute: string): string => relative(ROOT, absolute).split("\\").join("/");

/** Every `import … from "…"` / `export … from "…"` specifier in one file. */
const specifiersOf = (source: string): string[] => {
	const pattern = /\b(?:import|export)\b[^;\n]*?\bfrom\s+"([^"]+)"|\bimport\s+"([^"]+)"/g;
	return [...source.matchAll(pattern)].map((match) => match[1] ?? match[2] ?? "");
};

const resolveSpecifier = (fromFile: string, specifier: string): string | null => {
	if (!specifier.startsWith(".")) {
		return null;
	}
	const base = resolve(dirname(fromFile), specifier);
	for (const candidate of [
		`${base}.ts`,
		`${base}.tsx`,
		join(base, "index.ts"),
		join(base, "index.tsx"),
		base,
	]) {
		if (/\.tsx?$/.test(candidate) && existsSync(candidate)) {
			return toRepoPath(candidate);
		}
	}
	return null;
};

interface Module {
	readonly path: string;
	readonly lines: number;
	readonly imports: readonly string[];
}

const loadModules = (): Module[] =>
	walk(SRC).map((absolute) => {
		const source = readFileSync(absolute, "utf8");
		const newlines = source.split("\n").length;
		return {
			path: toRepoPath(absolute),
			lines: source.endsWith("\n") ? newlines - 1 : newlines,
			imports: specifiersOf(source)
				.map((specifier) => resolveSpecifier(absolute, specifier))
				.filter((target): target is string => target !== null),
		};
	});

const modules = loadModules();
const byPath = new Map(modules.map((module) => [module.path, module]));

/** Strongly connected components with more than one member, or a self-import. */
const cycles = (): string[][] => {
	let index = 0;
	const indices = new Map<string, number>();
	const low = new Map<string, number>();
	const onStack = new Set<string>();
	const stack: string[] = [];
	const found: string[][] = [];

	const strongConnect = (node: string): void => {
		indices.set(node, index);
		low.set(node, index);
		index += 1;
		stack.push(node);
		onStack.add(node);

		for (const next of byPath.get(node)?.imports ?? []) {
			if (!indices.has(next)) {
				strongConnect(next);
				low.set(node, Math.min(low.get(node) ?? 0, low.get(next) ?? 0));
			} else if (onStack.has(next)) {
				low.set(node, Math.min(low.get(node) ?? 0, indices.get(next) ?? 0));
			}
		}

		if (low.get(node) !== indices.get(node)) {
			return;
		}
		const component: string[] = [];
		let member = "";
		do {
			member = stack.pop() as string;
			onStack.delete(member);
			component.push(member);
		} while (member !== node);
		if (
			component.length > 1 ||
			(component.length === 1 && byPath.get(node)?.imports.includes(node) === true)
		) {
			found.push(component.sort());
		}
	};

	for (const module of modules) {
		if (!indices.has(module.path)) {
			strongConnect(module.path);
		}
	}
	return found;
};

describe("architecture", () => {
	test("no import cycle outside the one this rule was seeded with", () => {
		const canonical = (component: readonly string[]): string => [...component].sort().join(" | ");
		const allowed = new Set(KNOWN_CYCLES.map(canonical));
		const unexpected = cycles().filter((component) => !allowed.has(canonical(component)));

		// A cycle is not a style problem: it means neither file can be read, tested or
		// deleted on its own, which is the cost this whole refactor is paying down.
		expect(unexpected.map(canonical)).toEqual([]);
	});

	test("the seeded cycle is still the only one, so the allowlist cannot go stale", () => {
		const canonical = (component: readonly string[]): string => [...component].sort().join(" | ");
		const present = new Set(cycles().map(canonical));
		const stale = KNOWN_CYCLES.filter((component) => !present.has(canonical(component)));

		expect(stale).toEqual([]);
	});

	test("no source file grows past its budget", () => {
		const budget = JSON.parse(readFileSync(BUDGET_PATH, "utf8")) as Record<string, number>;
		const over = modules
			.map((module) => ({
				path: module.path,
				lines: module.lines,
				limit: budget[module.path] ?? DEFAULT_MAX_LINES,
			}))
			.filter((entry) => entry.lines > entry.limit)
			.map((entry) => `${entry.path}: ${entry.lines} lines, budget ${entry.limit}`);

		// A budget may only go down. When a split lands, lower or delete the entry — a file
		// that grows back into the space it gave up fails here.
		expect(over).toEqual([]);
	});

	test("a folder that publishes an index.ts is entered through it", () => {
		const barrels = new Map<string, string>();
		for (const module of modules) {
			if (module.path.endsWith("/index.ts") || module.path.endsWith("/index.tsx")) {
				barrels.set(dirname(module.path), module.path);
			}
		}

		const bypasses = modules.flatMap((module) =>
			module.imports.flatMap((target) => {
				const folder = dirname(target);
				const barrel = barrels.get(folder);
				if (barrel === undefined || barrel === target) {
					return [];
				}
				// Only imports coming from *outside* the folder are a bypass: files inside
				// a module use each other directly, which is what a module is.
				const inside = module.path.startsWith(`${folder}/`);
				return inside ? [] : [`${module.path} → ${target} (use ${barrel})`];
			}),
		);

		expect(bypasses).toEqual([]);
	});

	test("two use cases never import each other", () => {
		const violations = modules
			.filter((module) => module.path.startsWith("src/app/usecases/"))
			.flatMap((module) =>
				module.imports
					.filter(
						(target) =>
							target.startsWith("src/app/usecases/") && dirname(target) === dirname(module.path),
					)
					.map((target) => `${module.path} → ${target}`),
			);

		// Two slices that share code belong in `domain` or behind a port; importing a
		// sibling is how a "slice" becomes a layer with extra folders.
		expect(violations).toEqual([]);
	});

	test("the scan sees the whole tree, so a green run means something", () => {
		// Guards the guards: a walk that silently returns nothing would make every
		// assertion above vacuously true.
		expect(modules.length).toBeGreaterThan(50);
		expect(modules.some((module) => module.path === "src/cli.tsx")).toBe(true);
	});
});
