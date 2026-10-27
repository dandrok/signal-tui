import { accessSync, constants, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname } from "node:path";
import type { CommandResult, CommandRunner, Probes } from "./types";

const unavailable = (): CommandResult => ({ code: 127, stdout: "", stderr: "" });

/** Real runner: a missing executable surfaces as a failing result, never a throw. */
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

/** Runs the external commands and stats the cache; one pass, so the report describes one moment. */
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
	// A missing executable looks like 127 with no output: that is "not installed", not
	// "installed but broken", and the two need different advice.
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

	const modeExposed = (path: string, mask: number): boolean => {
		try {
			return (statSync(path).mode & mask) !== 0;
		} catch {
			return false; // not created yet
		}
	};

	return {
		bunVersion: options.bunVersion,
		signalCliVersion: signalCli.code === 0 ? firstLine(signalCli.stdout) : null,
		signalCliError,
		javaVersion: java.code === 0 ? firstLine(`${java.stderr}${java.stdout}`) : null,
		accounts,
		dbWritable,
		dbPath: options.dbPath,
		dbExposed: modeExposed(options.dbPath, 0o077),
		dbDirExposed: modeExposed(directory, 0o022),
	};
}
