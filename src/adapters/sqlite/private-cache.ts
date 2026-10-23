import { chmodSync, statSync } from "node:fs";

/**
 * Message bodies are plaintext, so the cache must not be readable by anyone else.
 * SQLite copies the database file's mode onto its `-wal` and `-shm` files, which
 * is why setting it on the main file is enough.
 */
export function restrictCachePermissions(path: string): void {
	try {
		chmodSync(path, 0o600);
		return;
	} catch (error) {
		// Refuse to run against a readable cache, but only when the mode is actually
		// exposed: filesystems where chmod is meaningless report no group/other bits.
		const mode = statSync(path).mode & 0o077;
		if (mode !== 0) {
			throw new Error(
				`cannot restrict cache permissions (${path}): ${error instanceof Error ? error.message : String(error)}`,
				{ cause: error },
			);
		}
	}
}
