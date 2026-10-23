import { homedir } from "node:os";
import { join } from "node:path";

export type CliConfig =
	| { readonly mode: "help" }
	| { readonly mode: "demo" }
	| { readonly mode: "live"; readonly account: string; readonly dbPath: string };

/** A problem with what the user typed, as opposed to a bug: reported without a stack. */
export class UsageError extends Error {}

export interface ParseOptions {
	readonly defaultDbPath: string;
}

const ACCOUNT_PATTERN = /^\+[1-9]\d{6,14}$/;

export function assertAccount(value: string): string {
	if (!ACCOUNT_PATTERN.test(value)) {
		throw new UsageError(
			`expected a number in international form like +48123456789, got: ${value}`,
		);
	}
	return value;
}

/**
 * Pure argument parsing: no env reads, no fs, no exit. `signal-tui` with no
 * arguments prints usage rather than guessing a mode, because live mode needs an
 * account and silently falling back to demo hides that.
 */
export function parseArgs(argv: readonly string[], options: ParseOptions): CliConfig {
	let demo = false;
	let account: string | null = null;
	let dbPath = options.defaultDbPath;

	const next = (index: number, flag: string): string => {
		const value = argv[index];
		if (value === undefined) {
			throw new UsageError(`${flag} needs a value`);
		}
		return value;
	};

	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index] ?? "";

		if (arg === "--help" || arg === "-h") {
			return { mode: "help" };
		}
		if (arg === "--demo") {
			demo = true;
			continue;
		}
		if (arg === "--account") {
			account = assertAccount(next(index + 1, "--account"));
			index++;
			continue;
		}
		if (arg === "--db") {
			dbPath = next(index + 1, "--db");
			index++;
			continue;
		}
		if (arg.startsWith("--account=")) {
			account = assertAccount(arg.slice("--account=".length));
			continue;
		}
		if (arg.startsWith("--db=")) {
			dbPath = arg.slice("--db=".length);
			continue;
		}
		throw new UsageError(`unknown option: ${arg}`);
	}

	if (demo && account !== null) {
		throw new UsageError("--demo and --account cannot be combined");
	}
	if (account !== null) {
		return { mode: "live", account, dbPath };
	}
	if (demo) {
		return { mode: "demo" };
	}
	return { mode: "help" };
}

/** `$XDG_DATA_HOME/signal-tui/cache.db`, falling back to `~/.local/share`. */
export function defaultDbPath(
	env: Readonly<Record<string, string | undefined>> = process.env,
	home: string = homedir(),
): string {
	const base = env.XDG_DATA_HOME ?? join(home, ".local", "share");
	return join(base, "signal-tui", "cache.db");
}

export const USAGE = `signal-tui — a terminal Signal client

Usage:
  signal-tui --demo                        run on built-in sample data, no account
  signal-tui --account +48123456789        run against a linked signal-cli account
  signal-tui --help                        show this text

Options:
  --account <number>   account to act as; requires signal-cli on PATH
  --db <path>          cache location (default: ~/.local/share/signal-tui/cache.db)

Live mode needs signal-cli linked to your phone. Check your setup with:
  bun run doctor -- --account +48123456789`;
