import { mkdirSync, statSync } from "node:fs";
import { dirname } from "node:path";

/** The cache directory exists but other local users could replace its contents. */
export class UnsafeCacheDirectoryError extends Error {}

/**
 * Creates the cache directory owner-only, and refuses a pre-existing directory
 * that other users can write to: `mkdirSync`'s mode only applies on creation, so
 * a shared directory would let someone swap `cache.db` for their own file (or a
 * symlink) between our `chmod` and the next write.
 */
export function ensurePrivateDirectory(dbPath: string): string {
	const directory = dirname(dbPath);
	mkdirSync(directory, { recursive: true, mode: 0o700 });

	const mode = statSync(directory).mode & 0o777;
	if ((mode & 0o022) !== 0) {
		throw new UnsafeCacheDirectoryError(
			`cache directory ${directory} is writable by other users (mode ${mode.toString(8)}); pick a private location with --db`,
		);
	}
	return directory;
}
