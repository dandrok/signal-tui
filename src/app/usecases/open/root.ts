import { homedir } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";

/**
 * The one directory a launch may reach into, and the test that keeps it that way.
 *
 * Read the way `signal-cli` reads it rather than guessed from the account, because the engine
 * is what wrote the file: a guard that assumes the default location refuses the files of
 * everyone who moved their data, which reads as a broken key rather than a rule.
 */

/** The names the engine's global parser gives its data-directory option, one option each. */
const DATA_DIR_FLAGS = new Set(["--config", "--data-dir", "-c", "-d"]);
/** The two long names in their `=value` form; the short ones have no such spelling. */
const DATA_DIR_INLINE = ["--config=", "--data-dir="];

/**
 * Where signal-cli keeps what it downloaded: its own data directory, under `attachments`.
 *
 * In order:
 *
 *   - `--config <dir>` in the user's `engineArgs`, which *is* the engine's data directory — it
 *     is a global option, spliced in before `jsonRpc`, and a run that points the engine
 *     somewhere else puts its downloads there too;
 *   - `$XDG_DATA_HOME`, but only when it is absolute: the spec says a relative one is ignored,
 *     and the engine ignores it, so honouring it here would point the guard at a directory the
 *     engine never used;
 *   - `~/.local/share`.
 */
export function engineAttachmentsRoot(
	env: Readonly<Record<string, string | undefined>> = process.env,
	home: string = homedir(),
	engineArgs: readonly string[] = [],
): string {
	const configured = dataDir(engineArgs);
	if (configured !== null) {
		return join(configured, "attachments");
	}
	const data = env.XDG_DATA_HOME;
	const base = data !== undefined && isAbsolute(data) ? data : join(home, ".local", "share");
	return join(base, "signal-cli", "attachments");
}

/**
 * The directory the engine's data lives in, or null when the arguments do not name one.
 *
 * `--config`, `--data-dir`, `-c` and `-d` are **one** option with four names in signal-cli's
 * global parser (`App.java` declares them in a single `addArgument`), so all four count —
 * reading only the two long spellings would refuse the files of anyone who used the short one.
 * A relative path is resolved against the working directory, the same place the engine would
 * resolve it from, since it was started here. A flag with nothing usable after it is not a
 * directory: falling back beats inventing one.
 */
function dataDir(engineArgs: readonly string[]): string | null {
	for (const [index, arg] of engineArgs.entries()) {
		const inline = DATA_DIR_INLINE.find((flag) => arg.startsWith(flag));
		const separate = DATA_DIR_FLAGS.has(arg) ? (engineArgs[index + 1] ?? null) : null;
		const value = inline === undefined ? separate : arg.slice(inline.length);
		if (value === null) {
			continue;
		}
		return value.length === 0 || value.startsWith("-") ? null : resolve(value);
	}
	return null;
}

/**
 * Whether `path` is inside `root`, by the components of the path and not by its text.
 *
 * Both sides are resolved first, so `…/attachments/../.bashrc` is refused rather than read as
 * a clever path that starts with the root. The root itself is not a file, so equality does not
 * count: a launch has to name something *below* it.
 */
export function inAttachmentsDir(path: string, root: string): boolean {
	if (!isAbsolute(path) || !isAbsolute(root)) {
		return false;
	}
	const target = resolve(path);
	const base = resolve(root);
	return target.startsWith(base.endsWith(sep) ? base : `${base}${sep}`);
}
