import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Standing preferences: what the user wants every run, as opposed to what this run asks for.
 *
 * `flag > env > file > default`. The file is JSON because four settings do not pay for a parser
 * dependency, and a config file is not where comments belong when four keys fit in a README
 * table. Nothing secret goes in it: the account is a flag, and the cache location is not a
 * credential.
 *
 * What is deliberately absent is anything with no reader. `$EDITOR` waits until there is a
 * message long enough to leave the composer for it; a key stored today would be a promise the
 * binary does not keep.
 */

/** A config file that cannot be used, said in words that name the file and the setting. */
export class SettingsError extends Error {}

/** What a config file may say. Absent means "this file has no opinion". */
export interface SettingsFile {
	readonly notify?: boolean;
	readonly ignoreAttachments?: boolean;
	readonly db?: string;
	readonly engineArgs?: readonly string[];
}

/** What the file and the environment settled on, once the defaults are filled in. */
export interface Settings {
	/** Desktop toast and bell for a message in another thread. */
	readonly notify: boolean;
	/** Tell the engine not to download the files that arrive with messages. */
	readonly ignoreAttachments: boolean;
	/** Extra arguments for the engine, placed before its subcommand. */
	readonly engineArgs: readonly string[];
}

/** One table, used for validation and for the error that names what is allowed. */
const KNOWN = ["notify", "ignoreAttachments", "db", "engineArgs"] as const;

/** `$XDG_CONFIG_HOME/signal-tui/config.json`, falling back to `~/.config`. */
export function configPath(
	env: Readonly<Record<string, string | undefined>> = process.env,
	home: string = homedir(),
): string {
	const configured = env.XDG_CONFIG_HOME?.trim() ?? "";
	return join(
		configured.length > 0 ? configured : join(home, ".config"),
		"signal-tui",
		"config.json",
	);
}

const messageOf = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

/**
 * The file, as a value or as a complaint naming the file.
 *
 * An unknown key is an error rather than a shrug: a setting that is silently ignored is how a
 * typo becomes "the binary does not work". Arrays are rejected wherever a string belongs — a
 * config that parses but cannot be used is the same failure one step later.
 */
export function parseSettingsFile(text: string, path: string): SettingsFile {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch (error) {
		throw new SettingsError(`${path} is not valid JSON: ${messageOf(error)}`);
	}
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		throw new SettingsError(`${path} must contain a JSON object`);
	}

	let notify: boolean | undefined;
	let ignoreAttachments: boolean | undefined;
	let db: string | undefined;
	let engineArgs: readonly string[] | undefined;
	for (const [key, value] of Object.entries(raw)) {
		if (key === "notify") {
			if (typeof value !== "boolean") {
				throw new SettingsError(`${path}: "notify" must be true or false`);
			}
			notify = value;
		} else if (key === "ignoreAttachments") {
			if (typeof value !== "boolean") {
				throw new SettingsError(`${path}: "ignoreAttachments" must be true or false`);
			}
			ignoreAttachments = value;
		} else if (key === "db") {
			if (typeof value !== "string" || value.trim().length === 0) {
				throw new SettingsError(`${path}: "db" must be a file path`);
			}
			db = value;
		} else if (key === "engineArgs") {
			if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
				throw new SettingsError(`${path}: "engineArgs" must be a list of strings`);
			}
			engineArgs = value as readonly string[];
		} else {
			throw new SettingsError(`${path}: unknown setting "${key}" (known: ${KNOWN.join(", ")})`);
		}
	}
	return {
		...(ignoreAttachments === undefined ? {} : { ignoreAttachments }),
		...(notify === undefined ? {} : { notify }),
		...(db === undefined ? {} : { db }),
		...(engineArgs === undefined ? {} : { engineArgs }),
	};
}

/**
 * Reads the file, or reports why it could not be read.
 *
 * A missing file is not a problem — most runs have none — but an unreadable one is, because
 * silently falling back to defaults would ignore preferences the user took the trouble to write.
 */
export function readSettingsFile(
	path: string,
	read: (path: string) => string = (target) => readFileSync(target, "utf8"),
): SettingsFile {
	let text: string;
	try {
		text = read(path);
	} catch (error) {
		if ((error as { code?: string }).code === "ENOENT") {
			return {};
		}
		throw new SettingsError(`cannot read ${path}: ${messageOf(error)}`);
	}
	return parseSettingsFile(text, path);
}

/**
 * The cache location the file or the environment prefers, or the caller's default.
 *
 * Returned rather than applied: `--db` and `parseArgs` own the last word, and passing this in as
 * the default is what makes `flag > env > file > default` true without a second parser.
 */
export function cacheDefault(
	file: SettingsFile,
	env: Readonly<Record<string, string | undefined>>,
	fallback: string,
): string {
	return env.SIGNAL_TUI_DB?.trim() || file.db || fallback;
}

/**
 * What a run's preferences are, once the flags have had their say.
 *
 * `notify` and `ignoreAttachments` are the settings a flag can override today: `--db` is already
 * resolved by `parseArgs`, and engine arguments are a standing preference, not something to
 * retype per run.
 */
export function resolveSettings(sources: {
	readonly file: SettingsFile;
	readonly env?: Readonly<Record<string, string | undefined>>;
	/** `--no-notify` (false), `--notify` (true), or absent when the flag was not given. */
	readonly notify?: boolean | undefined;
	readonly ignoreAttachments?: boolean | undefined;
}): Settings {
	const env = sources.env ?? process.env;
	return {
		notify:
			sources.notify ??
			envFlag("SIGNAL_TUI_NOTIFY", env.SIGNAL_TUI_NOTIFY) ??
			sources.file.notify ??
			true,
		ignoreAttachments:
			sources.ignoreAttachments ??
			envFlag("SIGNAL_TUI_IGNORE_ATTACHMENTS", env.SIGNAL_TUI_IGNORE_ATTACHMENTS) ??
			sources.file.ignoreAttachments ??
			false,
		engineArgs: sources.file.engineArgs ?? [],
	};
}

/**
 * A boolean from the environment, spelled the way a shell spells one.
 *
 * A value nobody can interpret is refused rather than read as "on": an environment variable set
 * to `maybe` is a mistake, and guessing at it turns a typo into a setting the user cannot see.
 */
function envFlag(name: string, value: string | undefined): boolean | undefined {
	const text = value?.trim().toLowerCase() ?? "";
	if (text.length === 0) {
		return undefined;
	}
	if (["1", "true", "on", "yes"].includes(text)) {
		return true;
	}
	if (["0", "false", "off", "no"].includes(text)) {
		return false;
	}
	throw new SettingsError(`${name} must be on or off, got: ${value ?? ""}`);
}
