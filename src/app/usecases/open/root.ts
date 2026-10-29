import { homedir } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";

/**
 * The one directory a launch may reach into, and the test that keeps it that way.
 *
 * Read the way `signal-cli` reads it rather than guessed from the account, because the engine
 * is what wrote the file: a guard that assumes the default location refuses the files of
 * everyone who moved their data, which reads as a broken key rather than a rule.
 */

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
	const configured = configDir(engineArgs);
	if (configured !== null) {
		return join(configured, "attachments");
	}
	const data = env.XDG_DATA_HOME;
	const base = data !== undefined && isAbsolute(data) ? data : join(home, ".local", "share");
	return join(base, "signal-cli", "attachments");
}

/**
 * The directory `--config` names, or null when the arguments do not set one.
 *
 * Both spellings, because the engine accepts both, and a relative path is resolved against the
 * working directory — the same place the engine would resolve it from, since it was started
 * here. A flag with nothing after it is not a directory: falling back beats inventing one.
 */
function configDir(engineArgs: readonly string[]): string | null {
	for (const [index, arg] of engineArgs.entries()) {
		const inline = arg.startsWith("--config=") ? arg.slice("--config=".length) : null;
		const separate = arg === "--config" ? (engineArgs[index + 1] ?? null) : null;
		const value = inline ?? separate;
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
