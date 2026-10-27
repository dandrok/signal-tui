import type { Database } from "bun:sqlite";
import { migrations } from "./migrations";

/**
 * Applying the history, kept apart from the history itself: `migrations.ts` is an append-only
 * list of SQL that never changes, and this is the only code that runs it.
 */

/** The version the file reports. `doctor` prints it; the upgrade test asserts it moved. */
export function readSchemaVersion(db: Database): number {
	return db.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version ?? 0;
}

/**
 * Brings a file up to date, one transaction per step, and never re-runs a step that ran.
 *
 * The version is read from the file rather than a table: `user_version` cannot drift from the
 * schema it describes, and a half-applied migration cannot commit its number, because the
 * `PRAGMA` rides in the same transaction as the SQL.
 */
export function migrate(db: Database): void {
	const current = readSchemaVersion(db);
	for (const migration of migrations) {
		if (migration.version <= current) {
			continue;
		}
		db.transaction(() => {
			db.exec(migration.sql);
			db.exec(`PRAGMA user_version = ${migration.version}`);
		})();
	}
}
