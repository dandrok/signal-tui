import { accessSync, constants, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname } from "node:path";

export interface CommandResult {
	readonly code: number;
	readonly stdout: string;
	readonly stderr: string;
}

/** Injected so the doctor is testable without spawning anything. */
export interface CommandRunner {
	run(argv: readonly string[]): Promise<CommandResult>;
}

export interface Probes {
	readonly bunVersion: string;
	readonly signalCliVersion: string | null;
	/** Why `signal-cli --version` failed, when it ran but did not succeed. */
	readonly signalCliError: string | null;
	readonly javaVersion: string | null;
	/** Account numbers reported by `signal-cli listAccounts`, or null if it failed. */
	readonly accounts: readonly string[] | null;
	readonly dbWritable: boolean;
	readonly dbPath: string;
	/** True when the cache (if it exists) is readable by group or others. */
	readonly dbExposed: boolean;
	/** True when other users can write to the cache directory. */
	readonly dbDirExposed: boolean;
}

export type CheckStatus = "ok" | "warn" | "fail";

export interface Check {
	readonly name: string;
	readonly status: CheckStatus;
	readonly detail: string;
	readonly hint?: string | undefined;
}

const MINIMUM_BUN: readonly [number, number, number] = [1, 4, 3];
const MINIMUM_SIGNAL_CLI: readonly [number, number, number] = [0, 14, 0];
const MINIMUM_JAVA: readonly [number, number, number] = [25, 0, 0];

export function parseVersion(text: string | null): readonly [number, number, number] | null {
	if (text === null) {
		return null;
	}
	const match = text.match(/(\d+)\.(\d+)\.(\d+)/);
	if (match === null) {
		return null;
	}
	return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function atLeast(
	version: readonly [number, number, number] | null,
	minimum: readonly [number, number, number],
): boolean {
	if (version === null) {
		return false;
	}
	for (let index = 0; index < 3; index++) {
		const actual = version[index] ?? 0;
		const required = minimum[index] ?? 0;
		if (actual !== required) {
			return actual > required;
		}
	}
	return true;
}

export function evaluateChecks(
	probes: Probes,
	options: { readonly account?: string | undefined },
): readonly Check[] {
	const checks: Check[] = [];

	const bun = parseVersion(probes.bunVersion);
	checks.push({
		name: "bun runtime",
		status: atLeast(bun, MINIMUM_BUN) ? "ok" : "warn",
		detail: `Bun ${probes.bunVersion}`,
		hint: atLeast(bun, MINIMUM_BUN)
			? undefined
			: `the project targets Bun >= ${MINIMUM_BUN.join(".")}`,
	});

	if (probes.signalCliVersion === null) {
		checks.push(
			probes.signalCliError === null
				? {
						name: "signal-cli",
						status: "fail",
						detail: "not found on PATH",
						hint: "install signal-cli 0.14 or newer: https://github.com/AsamK/signal-cli#installation",
					}
				: {
						name: "signal-cli",
						status: "fail",
						detail: `found but failed to run: ${probes.signalCliError}`,
						hint: "run it directly to see the full error (that is not a missing binary)",
					},
		);
	} else if (!atLeast(parseVersion(probes.signalCliVersion), MINIMUM_SIGNAL_CLI)) {
		checks.push({
			name: "signal-cli",
			status: "fail",
			detail: `${probes.signalCliVersion} is older than ${MINIMUM_SIGNAL_CLI.slice(0, 2).join(".")}`,
			hint: "upgrade: releases older than ~3 months stop working as Signal changes",
		});
	} else {
		checks.push({ name: "signal-cli", status: "ok", detail: probes.signalCliVersion });
	}

	// A JVM-backed signal-cli cannot print its version without a suitable JRE, so a
	// working signal-cli means Java is either satisfied or unnecessary (native
	// build). Java only becomes actionable when signal-cli itself is failing.
	if (probes.signalCliVersion !== null) {
		checks.push({
			name: "java",
			status: "ok",
			detail:
				probes.javaVersion === null
					? "not installed — not needed by a native build"
					: `${probes.javaVersion} (not used by a native build)`,
		});
	} else if (probes.javaVersion === null) {
		checks.push({
			name: "java",
			status: "warn",
			detail: "not found on PATH",
			hint: `a JVM signal-cli needs JRE ${MINIMUM_JAVA[0]}+; the native build needs none`,
		});
	} else if (!atLeast(parseVersion(probes.javaVersion), MINIMUM_JAVA)) {
		checks.push({
			name: "java",
			status: "warn",
			detail: probes.javaVersion,
			hint: `a JVM signal-cli needs JRE ${MINIMUM_JAVA[0]}+; the native build needs none`,
		});
	} else {
		checks.push({ name: "java", status: "ok", detail: probes.javaVersion });
	}

	if (options.account !== undefined) {
		const account = options.account;
		const linked = probes.accounts?.includes(account) ?? false;
		checks.push({
			name: "linked account",
			status: linked ? "ok" : "fail",
			detail: linked
				? account
				: probes.accounts === null
					? "could not list accounts"
					: probes.accounts.length === 0
						? `no accounts linked (wanted ${account})`
						: `not linked (have ${probes.accounts.join(", ")})`,
			hint: linked ? undefined : `link it with: signal-cli link -n signal-tui`,
		});
	}

	checks.push({
		name: "cache database",
		status: probes.dbWritable ? "ok" : "fail",
		detail: probes.dbPath,
		hint: probes.dbWritable ? undefined : "the directory is not writable",
	});

	if (probes.dbWritable) {
		checks.push(
			probes.dbDirExposed
				? {
						name: "cache directory",
						status: "warn",
						detail: "writable by other users",
						hint: "another user could replace the database file; use a private directory",
					}
				: { name: "cache directory", status: "ok", detail: "owner-only" },
		);
		checks.push(
			probes.dbExposed
				? {
						name: "cache permissions",
						status: "warn",
						detail: "readable by other local users",
						hint: `message bodies are stored in plaintext: chmod 600 ${probes.dbPath}`,
					}
				: {
						name: "cache permissions",
						status: "ok",
						detail: "owner-only",
					},
		);
	}

	return checks;
}

export function hasFailures(checks: readonly Check[]): boolean {
	return checks.some((check) => check.status === "fail");
}

const unavailable = (): CommandResult => ({ code: 127, stdout: "", stderr: "" });

/** Node-backed runner: missing executables surface as a failing result, never a throw. */
export const processRunner: CommandRunner = {
	async run(argv: readonly string[]): Promise<CommandResult> {
		try {
			const process_ = Bun.spawnSync({ cmd: [...argv], stdout: "pipe", stderr: "pipe" });
			return {
				code: process_.exitCode ?? 1,
				stdout: process_.stdout.toString(),
				stderr: process_.stderr.toString(),
			};
		} catch {
			return unavailable();
		}
	},
};

const firstLine = (text: string): string | null => {
	const line = text
		.split("\n")
		.map((entry) => entry.trim())
		.find((entry) => entry.length > 0);
	return line ?? null;
};

export async function collectProbes(
	runner: CommandRunner,
	options: {
		readonly account?: string | undefined;
		readonly dbPath: string;
		readonly bunVersion: string;
	},
): Promise<Probes> {
	const signalCli = await runner.run(["signal-cli", "--version"]);
	const java = await runner.run(["java", "-version"]);

	const output = `${signalCli.stderr}${signalCli.stdout}`;
	// A missing executable looks like 127 with no output: that is "not installed",
	// not "installed but broken", and the two need different advice.
	const missing = signalCli.code === 127 && output.trim().length === 0;
	const signalCliError =
		signalCli.code === 0 || missing ? null : (firstLine(output) ?? `exit code ${signalCli.code}`);

	let accounts: readonly string[] | null = null;
	if (options.account !== undefined && signalCli.code === 0) {
		const listed = await runner.run(["signal-cli", "listAccounts"]);
		if (listed.code === 0) {
			accounts = listed.stdout
				.split("\n")
				.map((line) => line.trim())
				.filter((line) => line.startsWith("+"));
		}
	}

	const directory = dirname(options.dbPath);
	const dbWritable = ((): boolean => {
		try {
			mkdirSync(directory, { recursive: true, mode: 0o700 });
		} catch {
			return false;
		}
		try {
			// An existing database file must itself be writable, not just its parent.
			accessSync(existsSync(options.dbPath) ? options.dbPath : directory, constants.W_OK);
			return true;
		} catch {
			return false;
		}
	})();

	let dbExposed = false;
	let dbDirExposed = false;
	try {
		dbExposed = (statSync(options.dbPath).mode & 0o077) !== 0;
	} catch {
		dbExposed = false; // not created yet
	}
	try {
		dbDirExposed = (statSync(directory).mode & 0o022) !== 0;
	} catch {
		dbDirExposed = false;
	}

	return {
		bunVersion: options.bunVersion,
		signalCliVersion: signalCli.code === 0 ? firstLine(signalCli.stdout) : null,
		signalCliError,
		javaVersion: java.code === 0 ? firstLine(`${java.stderr}${java.stdout}`) : null,
		accounts,
		dbWritable,
		dbPath: options.dbPath,
		dbExposed,
		dbDirExposed,
	};
}
