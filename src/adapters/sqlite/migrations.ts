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
	{
		version: 2,
		// Files are stored beside their message rather than in a JSON column so a
		// deleted message can drop them without rewriting its row, and so the FTS
		// index stays exactly what it was: bodies only.
		sql: `
			CREATE TABLE attachments (
				message_id    TEXT    NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
				position      INTEGER NOT NULL,
				id            TEXT,
				content_type  TEXT,
				filename      TEXT,
				size          INTEGER,
				caption       TEXT,
				is_voice_note INTEGER NOT NULL DEFAULT 0,
				PRIMARY KEY (message_id, position)
			);

			CREATE INDEX attachments_message ON attachments(message_id);
		`,
	},
	{
		version: 3,
		// Edits replace a body that is already cached. The flag is what tells the
		// renderer the text was corrected, and it also stops a redelivered original
		// from overwriting the correction (see saveMessage's conflict branch).
		sql: `
			ALTER TABLE messages ADD COLUMN is_edited INTEGER NOT NULL DEFAULT 0;
		`,
	},
	{
		version: 4,
		// An edit has to be checked against the author of the message it targets,
		// not just the timestamp: within one group the sent time alone would let a
		// peer's edit land on somebody else's message. Rows cached before this
		// column existed stay NULL and fall back to the stored label.
		sql: `
			ALTER TABLE messages ADD COLUMN author_id TEXT;
		`,
	},
	{
		version: 5,
		// Disappearing messages. `expires_at` is computed from the message's own
		// `expiresInSeconds` at write time, so a message keeps the timer it was sent
		// under even if the conversation's timer changes later. `is_expired` marks a
		// row whose text has already been cleared, which is what stops the purge query
		// from rewriting the same rows forever.
		sql: `
			ALTER TABLE messages ADD COLUMN expires_at INTEGER;
			ALTER TABLE messages ADD COLUMN is_expired INTEGER NOT NULL DEFAULT 0;
			CREATE INDEX messages_expiry ON messages(expires_at) WHERE expires_at IS NOT NULL;
			ALTER TABLE conversations ADD COLUMN expires_in_seconds INTEGER;
		`,
	},
];
