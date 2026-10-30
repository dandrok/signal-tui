import { homedir } from "node:os";
import { join } from "node:path";

export type CliConfig =
	| { readonly mode: "help" }
	| { readonly mode: "version" }
	| { readonly mode: "demo"; readonly notify?: boolean; readonly ignoreAttachments?: boolean }
	| {
			readonly mode: "live";
			readonly account: string;
			readonly dbPath: string;
			/** Only present when a flag said so: absent means the config file and env decide. */
			readonly notify?: boolean;
			readonly ignoreAttachments?: boolean;
	  };

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
 * Rejects paths that would silently lose the cache: an empty path makes SQLite
 * open a private temp database, and `:memory:` (or a `file::memory:` URI) is a
 * database that disappears when the process exits.
 */
export function assertDbPath(value: string): string {
	const trimmed = value.trim();
	if (trimmed.length === 0) {
		throw new UsageError("--db needs a file path");
	}
	if (trimmed === ":memory:" || trimmed.startsWith("file::memory:")) {
		throw new UsageError("--db needs a real file: an in-memory cache is lost on exit");
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
	// Undefined is "the flag was not given", which is not the same as `false`: the file and the
	// environment still have a say below it. Only an explicit flag has the last word.
	let notify: boolean | undefined;
	let ignoreAttachments: boolean | undefined;

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
		if (arg === "--version" || arg === "-v") {
			return { mode: "version" };
		}
		if (arg === "--demo") {
			demo = true;
			continue;
		}
		if (arg === "--notify" || arg === "--no-notify") {
			notify = arg === "--notify";
			continue;
		}
		if (arg === "--ignore-attachments") {
			ignoreAttachments = true;
			continue;
		}
		if (arg === "--account") {
			account = assertAccount(next(index + 1, "--account"));
			index++;
			continue;
		}
		if (arg === "--db") {
			dbPath = assertDbPath(next(index + 1, "--db"));
			index++;
			continue;
		}
		if (arg.startsWith("--account=")) {
			account = assertAccount(arg.slice("--account=".length));
			continue;
		}
		if (arg.startsWith("--db=")) {
			dbPath = assertDbPath(arg.slice("--db=".length));
			continue;
		}
		throw new UsageError(`unknown option: ${arg}`);
	}

	if (demo && account !== null) {
		throw new UsageError("--demo and --account cannot be combined");
	}
	// Only the flags that were actually given: an absent key lets the file and the environment
	// speak, and `toEqual` in the tests can tell the two apart.
	const flags = {
		...(notify === undefined ? {} : { notify }),
		...(ignoreAttachments === undefined ? {} : { ignoreAttachments }),
	};
	if (account !== null) {
		return { mode: "live", account, dbPath, ...flags };
	}
	if (demo) {
		return { mode: "demo", ...flags };
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
  signal-tui --demo                        sample data, no account — the thread answers you
  signal-tui --account +48123456789        run against a linked signal-cli account
  signal-tui --version                     print the version
  signal-tui --help                        show this text

Options:
  --account <number>   account to act as; requires signal-cli on PATH
  --db <path>          cache location (default: $XDG_DATA_HOME/signal-tui/cache.db)
  --notify             desktop toast and bell for other threads (the default)
  --no-notify          same, switched off — for a pane nobody is looking at
  --ignore-attachments do not download the files that arrive with messages

Settings, standing preferences (flag > env > file > default):
  $XDG_CONFIG_HOME/signal-tui/config.json with "notify", "ignoreAttachments", "db" and
  "engineArgs" — engine arguments must be options of signal-cli itself, since they are
  placed before its subcommand

Live mode needs signal-cli 0.14+ on PATH, linked to your phone.
Setup guide: https://github.com/dandrok/signal-tui/blob/main/SETUP.md
From a clone, diagnostics: bun run doctor -- --account +481****6789`;
