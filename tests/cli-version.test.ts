import { describe, expect, test } from "bun:test";
import pkg from "../package.json" with { type: "json" };

const run = (...args: string[]) =>
	Bun.spawnSync([process.execPath, "run", "src/cli.tsx", ...args], {
		cwd: `${import.meta.dir}/..`,
		stdout: "pipe",
		stderr: "pipe",
	});

// Deleting the version branch in cli.tsx has to fail something: parsing alone
// would still return { mode: "version" } with no output behind it.
describe("--version", () => {
	for (const flag of ["--version", "-v"]) {
		test(`${flag} prints the version from package.json and exits 0`, () => {
			const result = run(flag);

			expect(result.stdout.toString().trim()).toBe(`signal-tui ${pkg.version}`);
			expect(result.exitCode).toBe(0);
		});
	}

	test("unknown flags exit 2 and say nothing on stdout", () => {
		const result = run("--nope");

		expect(result.exitCode).toBe(2);
		expect(result.stdout.toString()).toBe("");
	});
});
