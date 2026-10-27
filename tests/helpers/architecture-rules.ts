import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

/**
 * The architecture rules, as pure functions over a module graph.
 *
 * Kept out of the test file so each rule can be fed a synthetic graph and proven to fire.
 * A guard that only runs against the real tree is a guard nobody can falsify: the tree
 * happens not to contain the violation today, so the assertion passes whether or not the
 * detector works. The unit cases below build the violating shape on purpose.
 */

export interface SourceModule {
	/** Repo-relative path, e.g. `src/app/state.ts`. */
	readonly path: string;
	readonly lines: number;
	/** Repo-relative paths this module imports, already resolved. */
	readonly imports: readonly string[];
}

export const DEFAULT_MAX_LINES = 200;
export const USECASES_PREFIX = "src/app/usecases/";

/**
 * Every `import … from "…"` and `export … from "…"` specifier in a file.
 *
 * Two shapes have to be seen, and both were missed by an earlier version of this rule:
 * an import whose specifiers span several lines (`import {\n a,\n b,\n} from "./x";`) and
 * an import inside a comment (which is not an edge). Comments are stripped first, and the
 * match is allowed to cross newlines — the multi-line form is the common one in this repo,
 * so a line-bounded regex silently dropped most of the graph.
 */
export function specifiersOf(source: string): string[] {
	const withoutComments = source
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/(^|[^:])\/\/[^\n]*/g, "$1");
	const pattern = /\b(?:import|export)\b([\s\S]*?)\bfrom\s+"([^"]+)"|\bimport\s+"([^"]+)"/g;
	return [...withoutComments.matchAll(pattern)].map((match) => match[2] ?? match[3] ?? "");
}

/** Lines a file occupies, counting the way `wc -l` does. */
export function lineCount(source: string): number {
	const lines = source.split("\n").length;
	return source.endsWith("\n") ? lines - 1 : lines;
}

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
			return candidate;
		}
	}
	return null;
};

/** Reads `src/**` under `root` into the graph the rules below consume. */
export function loadModules(root: string): SourceModule[] {
	const walk = (dir: string): string[] =>
		readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) {
				return walk(path);
			}
			return entry.isFile() && /\.tsx?$/.test(entry.name) ? [path] : [];
		});

	return walk(join(root, "src")).map((absolute) => {
		const source = readFileSync(absolute, "utf8");
		return {
			path: relative(root, absolute).split("\\").join("/"),
			lines: lineCount(source),
			imports: specifiersOf(source)
				.map((specifier) => resolveSpecifier(absolute, specifier))
				.filter((target): target is string => target !== null)
				.map((target) => relative(root, target).split("\\").join("/")),
		};
	});
}

/** Strongly connected components with more than one member, plus self-imports. */
export function findCycles(modules: readonly SourceModule[]): string[][] {
	const graph = new Map(modules.map((module) => [module.path, module.imports]));
	const indices = new Map<string, number>();
	const low = new Map<string, number>();
	const onStack = new Set<string>();
	const stack: string[] = [];
	const found: string[][] = [];
	let next = 0;

	const connect = (node: string): void => {
		indices.set(node, next);
		low.set(node, next);
		next += 1;
		stack.push(node);
		onStack.add(node);

		for (const target of graph.get(node) ?? []) {
			if (!graph.has(target)) {
				continue;
			}
			if (!indices.has(target)) {
				connect(target);
				low.set(node, Math.min(low.get(node) ?? 0, low.get(target) ?? 0));
			} else if (onStack.has(target)) {
				low.set(node, Math.min(low.get(node) ?? 0, indices.get(target) ?? 0));
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
		if (component.length > 1 || (graph.get(node) ?? []).includes(node)) {
			found.push(component.sort());
		}
	};

	for (const module of modules) {
		if (!indices.has(module.path)) {
			connect(module.path);
		}
	}
	return found;
}

/**
 * Imports that enter a folder through a file other than its `index.ts`.
 *
 * A folder that publishes a barrel is a module with a public surface; reaching past it
 * makes the surface a fiction and lets an internal file move break callers silently.
 * Imports from *inside* the folder are exempt — files in one module use each other
 * directly, which is what a module is.
 */
export function findBarrelBypasses(modules: readonly SourceModule[]): string[] {
	const barrels = new Map<string, string>();
	for (const module of modules) {
		if (/\/(index\.ts|index\.tsx)$/.test(module.path)) {
			barrels.set(dirname(module.path), module.path);
		}
	}

	return modules.flatMap((module) =>
		module.imports.flatMap((target) => {
			const folder = dirname(target);
			const barrel = barrels.get(folder);
			if (barrel === undefined || barrel === target || module.path.startsWith(`${folder}/`)) {
				return [];
			}
			return [`${module.path} → ${target} (use ${barrel})`];
		}),
	);
}

/**
 * A use case reaching into a sibling slice.
 *
 * Slices are compared by their first segment under `usecases/`, so a slice that becomes a
 * folder (`usecases/react/index.ts`) is still one slice, and the folder's own barrel
 * (`usecases/index.ts`) is exempt as an importer because listing the slices is its job.
 */
export function findSiblingUsecaseImports(modules: readonly SourceModule[]): string[] {
	const sliceOf = (path: string): string | null => {
		if (!path.startsWith(USECASES_PREFIX)) {
			return null;
		}
		const rest = path.slice(USECASES_PREFIX.length);
		if (rest.startsWith("index.")) {
			return null;
		}
		return rest.split("/")[0] ?? null;
	};

	return modules.flatMap((module) => {
		const home = sliceOf(module.path);
		if (home === null) {
			return [];
		}
		return module.imports.flatMap((target) => {
			const other = sliceOf(target);
			return other !== null && other !== home ? [`${module.path} → ${target}`] : [];
		});
	});
}

export interface OverBudget {
	readonly path: string;
	readonly lines: number;
	readonly limit: number;
}

/** Files bigger than their budget, defaulting to the shared cap. */
export function findOverBudget(
	modules: readonly SourceModule[],
	budget: Readonly<Record<string, number>>,
): OverBudget[] {
	return modules
		.map((module) => ({
			path: module.path,
			lines: module.lines,
			limit: budget[module.path] ?? DEFAULT_MAX_LINES,
		}))
		.filter((entry) => entry.lines > entry.limit);
}
