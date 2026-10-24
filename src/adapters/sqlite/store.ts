import { Database } from "bun:sqlite";
import type { Conversation, ConversationId, Message, MessageId } from "../../domain/types";
import type { MessageStore } from "../../ports/store";
import { deleteAttachments, loadAttachments, replaceAttachments } from "./attachments";
import { toFtsQuery } from "./fts";
import { migrations } from "./migrations";
import { restrictCachePermissions } from "./private-cache";

const DEFAULT_MESSAGE_LIMIT = 50;
const DEFAULT_SEARCH_LIMIT = 20;

interface MessageRow {
	id: string;
	conversation_id: string;
	author: string;
	body: string;
	sent_at: number;
	is_outgoing: number;
	is_deleted: number;
	is_edited: number;
}

interface ConversationRow {
	id: string;
	name: string;
	unread_count: number;
	last_activity_at: number;
}

export function toMessage(row: MessageRow): Message {
	return {
		id: row.id,
		conversationId: row.conversation_id,
		author: row.author,
		body: row.body,
		sentAt: row.sent_at,
		isOutgoing: row.is_outgoing === 1,
		isDeleted: row.is_deleted === 1,
		isEdited: row.is_edited === 1,
	};
}

export function toConversation(row: ConversationRow): Conversation {
	return {
		id: row.id,
		name: row.name,
		unreadCount: row.unread_count,
		lastActivityAt: row.last_activity_at,
	};
}

export interface SqliteStoreOptions {
	/** File path, or ":memory:" for tests. */
	readonly path: string;
	readonly messageLimit?: number;
	readonly searchLimit?: number;
}

/**
 * Durable message cache: SQLite for storage, FTS5 for search.
 *
 * Writes are single-row upserts, so replaying the same envelope twice is a
 * no-op that still refreshes edited bodies. Foreign keys are enforced: a
 * message's conversation must be written first, which keeps the cache free of
 * orphaned rows when a sync stream is replayed out of order.
 */
export class SqliteMessageStore implements MessageStore {
	readonly #db: Database;
	readonly #messageLimit: number;
	readonly #searchLimit: number;

	constructor(options: SqliteStoreOptions) {
		this.#messageLimit = options.messageLimit ?? DEFAULT_MESSAGE_LIMIT;
		this.#searchLimit = options.searchLimit ?? DEFAULT_SEARCH_LIMIT;
		this.#db = new Database(options.path, { create: true, strict: true });

		try {
			this.#db.exec("PRAGMA foreign_keys = ON;");
			if (options.path !== ":memory:") {
				this.#db.exec("PRAGMA journal_mode = WAL;");
				restrictCachePermissions(options.path);
			}
			this.#migrate();
		} catch (error) {
			// Construction failed, so the caller never gets an instance to close.
			this.#db.close();
			throw error;
		}
	}

	/** Applied schema version, useful for `doctor` output and tests. */
	get schemaVersion(): number {
		return (
			this.#db.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version ?? 0
		);
	}

	async listConversations(): Promise<readonly Conversation[]> {
		const rows = this.#db
			.query<ConversationRow, []>(
				`SELECT id, name, unread_count, last_activity_at
				 FROM conversations
				 ORDER BY last_activity_at DESC, id ASC`,
			)
			.all();
		return rows.map(toConversation);
	}

	async listMessages(
		conversationId: ConversationId,
		limit = this.#messageLimit,
	): Promise<readonly Message[]> {
		if (limit <= 0) {
			return [];
		}
		// Newest N, then flipped back into reading order.
		const rows = this.#db
			.query<MessageRow, [string, number]>(
				`SELECT * FROM (
					SELECT id, conversation_id, author, body, sent_at, is_outgoing, is_deleted, is_edited
					FROM messages
					WHERE conversation_id = ?1
					ORDER BY sent_at DESC, id DESC
					LIMIT ?2
				 ) ORDER BY sent_at ASC, id ASC`,
			)
			.all(conversationId, limit);
		return this.#withAttachments(rows.map(toMessage));
	}

	async listAllMessages(conversationId: ConversationId): Promise<readonly Message[]> {
		const rows = this.#db
			.query<MessageRow, [string]>(
				`SELECT id, conversation_id, author, body, sent_at, is_outgoing, is_deleted, is_edited
				 FROM messages
				 WHERE conversation_id = ?1
				 ORDER BY sent_at ASC, id ASC`,
			)
			.all(conversationId);
		return this.#withAttachments(rows.map(toMessage));
	}

	async search(query: string, limit = this.#searchLimit): Promise<readonly Message[]> {
		const ftsQuery = toFtsQuery(query);
		if (ftsQuery === null || limit <= 0) {
			return [];
		}
		const rows = this.#db
			.query<MessageRow, [string, number]>(
				`SELECT m.id, m.conversation_id, m.author, m.body, m.sent_at, m.is_outgoing, m.is_deleted, m.is_edited
				 FROM messages_fts
				 JOIN messages m ON m.rowid = messages_fts.rowid
				 WHERE messages_fts MATCH ?1
				   AND m.is_deleted = 0
				 ORDER BY bm25(messages_fts), m.sent_at DESC
				 LIMIT ?2`,
			)
			.all(ftsQuery, limit);
		return this.#withAttachments(rows.map(toMessage));
	}

	async upsertConversation(conversation: Conversation): Promise<void> {
		this.#db
			.query<null, [string, string, number, number]>(
				`INSERT INTO conversations (id, name, unread_count, last_activity_at)
				 VALUES (?1, ?2, ?3, ?4)
				 ON CONFLICT(id) DO UPDATE SET
					name = CASE WHEN TRIM(excluded.name) = '' THEN conversations.name ELSE excluded.name END,
					last_activity_at = MAX(conversations.last_activity_at, excluded.last_activity_at)`,
			)
			.run(
				conversation.id,
				conversation.name,
				conversation.unreadCount,
				conversation.lastActivityAt,
			);
	}

	async incrementUnread(conversationId: ConversationId, by: number): Promise<void> {
		this.#db
			.query<null, [number, string]>(
				"UPDATE conversations SET unread_count = unread_count + ?1 WHERE id = ?2",
			)
			.run(by, conversationId);
	}

	async markConversationRead(conversationId: ConversationId): Promise<boolean> {
		const result = this.#db
			.query<null, [string]>(
				// The guard makes the result meaningful: an already-read conversation
				// reports no change, which is what stops the UI feedback loop.
				"UPDATE conversations SET unread_count = 0 WHERE id = ?1 AND unread_count > 0",
			)
			.run(conversationId);
		return result.changes > 0;
	}

	async saveMessage(message: Message): Promise<{ readonly inserted: boolean }> {
		type SaveParams = [string, string, string, string, number, number, number];
		const params: SaveParams = [
			message.id,
			message.conversationId,
			message.author,
			message.body,
			message.sentAt,
			message.isOutgoing ? 1 : 0,
			message.isDeleted ? 1 : 0,
		];

		// One write on the common path: a message seen once is inserted, and only a
		// replay or an edit falls through to the update. The transaction keeps the
		// message and its attachment rows from ever disagreeing.
		const inserted = this.#db.transaction(() => {
			const changes = this.#db
				.query<null, SaveParams>(
					`INSERT INTO messages (id, conversation_id, author, body, sent_at, is_outgoing, is_deleted, is_edited)
					 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0)
					 ON CONFLICT(id) DO NOTHING`,
				)
				.run(...params).changes;

			if (changes === 0) {
				this.#db
					.query<null, SaveParams>(
						// A redelivered original must not overwrite a correction: once a
						// message is edited, only another edit changes its body.
						`UPDATE messages SET author = ?3,
						        body = CASE WHEN is_edited = 1 THEN body ELSE ?4 END,
						        sent_at = ?5, is_outgoing = ?6, is_deleted = ?7
						 WHERE id = ?1 AND conversation_id = ?2`,
					)
					.run(...params);
			}

			replaceAttachments(this.#db, message);
			return changes;
		})();

		return { inserted: inserted > 0 };
	}

	async applyEdit(
		conversationId: ConversationId,
		targetSentAt: number,
		body: string,
	): Promise<boolean> {
		// The FTS triggers on `messages` re-index the new body, so search follows the
		// edit without a second write. A deleted message keeps its blank body.
		const result = this.#db
			.query<null, [string, number, string]>(
				`UPDATE messages SET body = ?3, is_edited = 1
				 WHERE conversation_id = ?1 AND sent_at = ?2 AND is_deleted = 0`,
			)
			.run(conversationId, targetSentAt, body);
		return result.changes > 0;
	}

	async markMessageDeleted(conversationId: ConversationId, messageId: MessageId): Promise<void> {
		this.#db.transaction(() => {
			this.#db
				.query<null, [string, string]>(
					`UPDATE messages SET is_deleted = 1, body = ''
					 WHERE id = ?1 AND conversation_id = ?2`,
				)
				.run(messageId, conversationId);
			// The files on disk are signal-cli's, but the references are ours and a
			// deleted message should not keep pointing at them.
			deleteAttachments(this.#db, messageId);
		})();
	}

	close(): void {
		this.#db.close();
	}

	#withAttachments(messages: readonly Message[]): readonly Message[] {
		if (messages.length === 0) {
			return messages;
		}
		const byMessage = loadAttachments(
			this.#db,
			messages.map((message) => message.id),
		);
		// Always an array on the way out, even when empty: a caller reading a message
		// should not have to distinguish "no files" from "field absent".
		return messages.map((message) => ({
			...message,
			attachments: byMessage.get(message.id) ?? [],
		}));
	}

	#migrate(): void {
		const current = this.schemaVersion;
		for (const migration of migrations) {
			if (migration.version <= current) {
				continue;
			}
			this.#db.transaction(() => {
				this.#db.exec(migration.sql);
				this.#db.exec(`PRAGMA user_version = ${migration.version}`);
			})();
		}
	}
}
