import type { Check, Probes } from "../types";

/**
 * The cache: whether it can be written, and whether anyone else can read it.
 *
 * Bodies are stored in plaintext, so permissions are a check of their own rather than a
 * footnote on the file check — that is the whole difference between a private cache and a
 * readable transcript of somebody's conversations. Both are asked only when the file is
 * writable, because "cannot write" makes the rest noise.
 */
export function cacheChecks(probes: Probes): readonly Check[] {
	const checks: Check[] = [
		{
			name: "cache database",
			status: probes.dbWritable ? "ok" : "fail",
			detail: probes.dbPath,
			hint: probes.dbWritable ? undefined : "the directory is not writable",
		},
	];

	if (!probes.dbWritable) {
		return checks;
	}

	checks.push(
		probes.dbDirExposed
			? {
					name: "cache directory",
					status: "warn",
					detail: "writable by other users",
					hint: "another user could replace the database file; use a private directory",
				}
			: { name: "cache directory", status: "ok", detail: "owner-only" },
		probes.dbExposed
			? {
					name: "cache permissions",
					status: "warn",
					detail: "readable by other local users",
					hint: `message bodies are stored in plaintext: chmod 600 ${probes.dbPath}`,
				}
			: { name: "cache permissions", status: "ok", detail: "owner-only" },
	);
	return checks;
}
