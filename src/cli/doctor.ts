import { accessSync, constants, mkdirSync } from "node:fs";
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
	readonly javaVersion: string | null;
	/** Account numbers reported by `signal-cli listAccounts`, or null if it failed. */
	readonly accounts: readonly string[] | null;
	readonly dbWritable: boolean;
	readonly dbPath: string;
}

export type CheckStatus = "ok" | "warn" | "fail";

export interface Check {
	readonly name: string;
	readonly status: CheckStatus;
	readonly detail: string;
	readonly hint?: string | undefined;
}

const MINIMUM_BUN: readonly [number, number, number] = [1, 4, 4];
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

	checks.push(
		probes.signalCliVersion === null
			? {
					name: "signal-cli",
					status: "fail",
					detail: "not found on PATH",
					hint: "install signal-cli 0.14 or newer: https://github.com/AsamK/signal-cli#installation",
				}
			: { name: "signal-cli", status: "ok", detail: probes.signalCliVersion },
	);

	const java = parseVersion(probes.javaVersion);
	if (probes.javaVersion === null) {
		checks.push({
			name: "java",
			status: probes.signalCliVersion === null ? "warn" : "fail",
			detail: "not found on PATH",
			hint: `signal-cli needs a JRE ${MINIMUM_JAVA[0]}+, or use the GraalVM native build which bundles it`,
		});
	} else {
		checks.push({
			name: "java",
			status: atLeast(java, MINIMUM_JAVA) ? "ok" : "warn",
			detail: probes.javaVersion,
			hint: atLeast(java, MINIMUM_JAVA)
				? undefined
				: `signal-cli 0.14+ needs Java ${MINIMUM_JAVA[0]}+; alternatively use the -Linux-native release`,
		});
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

	let dbWritable = false;
	try {
		const directory = dirname(options.dbPath);
		mkdirSync(directory, { recursive: true });
		accessSync(directory, constants.W_OK);
		dbWritable = true;
	} catch {
		dbWritable = false;
	}

	return {
		bunVersion: options.bunVersion,
		signalCliVersion: signalCli.code === 0 ? firstLine(signalCli.stdout) : null,
		javaVersion: java.code === 0 ? firstLine(`${java.stderr}${java.stdout}`) : null,
		accounts,
		dbWritable,
		dbPath: options.dbPath,
	};
}
