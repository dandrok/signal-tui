export interface Migration {
	readonly version: number;
	readonly sql: string;
}

/**
 * Schema history. Append-only: never edit a shipped migration, add the next one.
 *
 * `messages_fts` is an FTS5 external-content index over `messages.body`; the
 * triggers keep it in sync for every insert, update and delete, so search never
 * needs a manual rebuild.
 */
export const migrations: readonly Migration[] = [
	{
		version: 1,
		sql: `
			CREATE TABLE conversations (
				id               TEXT    PRIMARY KEY,
				name             TEXT    NOT NULL,
				unread_count     INTEGER NOT NULL DEFAULT 0,
				last_activity_at INTEGER NOT NULL
			);

			CREATE TABLE messages (
				id              TEXT    PRIMARY KEY,
				conversation_id TEXT    NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
				author          TEXT    NOT NULL,
				body            TEXT    NOT NULL,
				sent_at         INTEGER NOT NULL,
				is_outgoing     INTEGER NOT NULL DEFAULT 0,
				is_deleted      INTEGER NOT NULL DEFAULT 0
			);

			CREATE INDEX conversations_activity ON conversations(last_activity_at DESC);
			CREATE INDEX messages_conversation_sent ON messages(conversation_id, sent_at DESC, id DESC);

			CREATE VIRTUAL TABLE messages_fts USING fts5(
				body,
				content = 'messages',
				content_rowid = 'rowid'
			);

			CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN
				INSERT INTO messages_fts(rowid, body) VALUES (new.rowid, new.body);
			END;

			CREATE TRIGGER messages_ad AFTER DELETE ON messages BEGIN
				INSERT INTO messages_fts(messages_fts, rowid, body) VALUES ('delete', old.rowid, old.body);
			END;

			CREATE TRIGGER messages_au AFTER UPDATE ON messages BEGIN
				INSERT INTO messages_fts(messages_fts, rowid, body) VALUES ('delete', old.rowid, old.body);
				INSERT INTO messages_fts(rowid, body) VALUES (new.rowid, new.body);
			END;
		`,
	},
];
