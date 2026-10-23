import { describe, expect, test } from "bun:test";
import type { Check, CommandRunner, Probes } from "../src/cli/doctor";
import {
	atLeast,
	collectProbes,
	evaluateChecks,
	hasFailures,
	parseVersion,
} from "../src/cli/doctor";

const probes = (overrides: Partial<Probes> = {}): Probes => ({
	bunVersion: "1.4.4",
	signalCliVersion: "signal-cli 0.14.9",
	javaVersion: 'openjdk version "25.0.1" 2026-09-16',
	accounts: ["+48123456789"],
	dbWritable: true,
	dbPath: "/tmp/signal-tui/cache.db",
	...overrides,
});

const find = (checks: readonly Check[], name: string): Check | undefined =>
	checks.find((check) => check.name === name);

describe("parseVersion / atLeast", () => {
	test("reads a version out of noisy output", () => {
		expect(parseVersion('openjdk version "21.0.4" 2026-07-16')).toEqual([21, 0, 4]);
		expect(parseVersion("signal-cli 0.14.9")).toEqual([0, 14, 9]);
	});

	test("returns null when there is no version", () => {
		expect(parseVersion("no numbers here")).toBeNull();
		expect(parseVersion(null)).toBeNull();
	});

	test("compares numerically, not lexically", () => {
		expect(atLeast([1, 4, 4], [1, 4, 4])).toBe(true);
		expect(atLeast([1, 10, 0], [1, 9, 9])).toBe(true);
		expect(atLeast([1, 4, 3], [1, 4, 4])).toBe(false);
		expect(atLeast([25, 0, 0], [25, 0, 0])).toBe(true);
		expect(atLeast(null, [1, 0, 0])).toBe(false);
	});
});

describe("evaluateChecks", () => {
	test("passes everything on a ready machine", () => {
		const checks = evaluateChecks(probes(), { account: "+48123456789" });

		expect(hasFailures(checks)).toBe(false);
		expect(checks.map((check) => check.status)).toEqual(["ok", "ok", "ok", "ok", "ok"]);
	});

	test("fails when signal-cli is missing, with an install hint", () => {
		const checks = evaluateChecks(probes({ signalCliVersion: null }), {});
		const signalCli = find(checks, "signal-cli");

		expect(signalCli?.status).toBe("fail");
		expect(signalCli?.hint).toContain("install signal-cli");
	});

	test("warns about old java rather than failing", () => {
		const checks = evaluateChecks(probes({ javaVersion: 'openjdk version "17.0.20.1"' }), {});
		const java = find(checks, "java");

		expect(java?.status).toBe("warn");
		expect(java?.hint).toContain("25");
	});

	test("fails when the account is not linked", () => {
		const checks = evaluateChecks(probes({ accounts: ["+48999999999"] }), {
			account: "+48123456789",
		});
		const linked = find(checks, "linked account");

		expect(linked?.status).toBe("fail");
		expect(linked?.detail).toContain("+48999999999");
		expect(linked?.hint).toContain("signal-cli link");
	});

	test("reports an unreadable account list distinctly from an empty one", () => {
		const unreadable = find(
			evaluateChecks(probes({ accounts: null }), { account: "+48123456789" }),
			"linked account",
		);
		const empty = find(
			evaluateChecks(probes({ accounts: [] }), { account: "+48123456789" }),
			"linked account",
		);

		expect(unreadable?.detail).toBe("could not list accounts");
		expect(empty?.detail).toContain("no accounts linked");
	});

	test("fails when the cache directory is not usable", () => {
		const checks = evaluateChecks(probes({ dbWritable: false }), {});
		expect(find(checks, "cache database")?.status).toBe("fail");
	});

	test("skips the account check when no account was given", () => {
		const checks = evaluateChecks(probes(), {});
		expect(find(checks, "linked account")).toBeUndefined();
	});
});

describe("collectProbes", () => {
	const runner = (
		results: Record<string, { code: number; stdout: string; stderr: string }>,
	): CommandRunner => ({
		async run(argv) {
			const key = argv.join(" ");
			return results[key] ?? { code: 127, stdout: "", stderr: "" };
		},
	});

	test("reads versions and filters the account list", async () => {
		const probes_ = await collectProbes(
			runner({
				"signal-cli --version": { code: 0, stdout: "signal-cli 0.14.9\n", stderr: "" },
				"java -version": { code: 0, stdout: "", stderr: 'openjdk version "25.0.1" 2026-09-16\n' },
				"signal-cli listAccounts": { code: 0, stdout: "+48123456789\n+48999999999\n", stderr: "" },
			}),
			{ account: "+48123456789", dbPath: "/tmp/signal-tui-probe/cache.db", bunVersion: "1.4.4" },
		);

		expect(probes_.signalCliVersion).toBe("signal-cli 0.14.9");
		expect(probes_.javaVersion).toContain("25.0.1");
		expect(probes_.accounts).toEqual(["+48123456789", "+48999999999"]);
		expect(probes_.dbWritable).toBe(true);
	});

	test("treats a missing signal-cli as absent, and does not list accounts", async () => {
		let listed = false;
		const probes_ = await collectProbes(
			{
				async run(argv) {
					if (argv.join(" ") === "signal-cli listAccounts") {
						listed = true;
					}
					return { code: 127, stdout: "", stderr: "" };
				},
			},
			{ account: "+48123456789", dbPath: "/tmp/signal-tui-probe2/cache.db", bunVersion: "1.4.4" },
		);

		expect(probes_.signalCliVersion).toBeNull();
		expect(probes_.accounts).toBeNull();
		expect(listed).toBe(false);
	});
});
