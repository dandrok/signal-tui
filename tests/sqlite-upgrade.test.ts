import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrations } from "../src/adapters/sqlite/migrations";
import { SqliteMessageStore } from "../src/adapters/sqlite/store";

/**
 * A cache written by an older release has to open without losing anything. The unit
 * tests all start from an empty file, which is the one case an upgrade never sees, so
 * this builds a v6 database the way 0.0.6 left it and opens it with today's code.
 */
const directories: string[] = [];

const cachePath = (): string => {
	const directory = mkdtempSync(join(tmpdir(), "signal-tui-upgrade-"));
	directories.push(directory);
	return join(directory, "cache.db");
};

afterEach(() => {
	for (const directory of directories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

const writeOldCache = (path: string): void => {
	const database = new Database(path, { create: true });
	for (const migration of migrations.filter((entry) => entry.version <= 6)) {
		database.exec(migration.sql);
		database.exec(`PRAGMA user_version = ${migration.version}`);
	}
	database.run(
		"INSERT INTO conversations (id, name, unread_count, last_activity_at) VALUES (?1, ?2, ?3, ?4)",
		["uuid-alice", "Alice", 2, 1_700_000_000_000],
	);
	database.run(
		`INSERT INTO messages (id, conversation_id, author, body, sent_at, is_outgoing, is_deleted)
		 VALUES (?1, ?2, ?3, ?4, ?5, 0, 0)`,
		["uuid-alice:1700000000000", "uuid-alice", "Alice", "written by 0.0.4", 1_700_000_000_000],
	);
	database.close();
};

describe("upgrading a cache written by an older release", () => {
	test("opens at the current version with every row intact", async () => {
		const path = cachePath();
		writeOldCache(path);

		const store = new SqliteMessageStore({ path });
		expect(store.schemaVersion).toBe(7);

		const [migrated] = await store.listMessages("uuid-alice");
		expect(migrated?.body).toBe("written by 0.0.4");
		expect(migrated?.author).toBe("Alice");
		// The columns are new, so an old row has nothing in them — not a default that
		// would pretend the message has an author id or a timer it never had.
		expect(migrated?.authorId).toBeUndefined();
		expect(migrated?.expiresAt).toBeUndefined();
		// Same rule for a receipt: the column defaults to "none", so a row cached by an
		// older release must not claim its message was delivered.
		expect(migrated?.receipt).toBeUndefined();
		// And a row cached before view-once was recognised must not claim to be one.
		expect(migrated?.isViewOnce).toBeUndefined();
		expect(await store.expiresInSeconds("uuid-alice")).toBeUndefined();
		store.close();
	});

	test("the new rules apply to old rows too", async () => {
		const path = cachePath();
		writeOldCache(path);

		const store = new SqliteMessageStore({ path });
		// A pre-v4 row has no author id, so its edit arrives as a label match.
		expect(
			await store.applyEdit("uuid-alice", 1_700_000_000_000, { id: null, label: "Alice" }, "fixed"),
		).toBe(true);

		// And a message added now can expire while the old one keeps its text.
		await store.saveMessage({
			id: "uuid-alice:1700000001000",
			conversationId: "uuid-alice",
			author: "Alice",
			body: "timed",
			sentAt: 1_700_000_001_000,
			isOutgoing: false,
			isDeleted: false,
			expiresAt: 1_700_000_002_000,
		});
		expect(await store.purgeExpired(1_800_000_000_000)).toBe(1);

		const after = await store.listMessages("uuid-alice");
		expect(after.find((entry) => entry.id === "uuid-alice:1700000000000")?.body).toBe("fixed");
		expect(after.find((entry) => entry.id === "uuid-alice:1700000001000")?.body).toBe("");
		store.close();
	});
});
