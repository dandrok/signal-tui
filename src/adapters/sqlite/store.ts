import { Database } from "bun:sqlite";
import type { Conversation, ConversationId, Message } from "../../domain/types";
import type { MessageStore } from "../../ports/store";
import { migrations } from "./migrations";

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

/**
 * Turns free text into a safe FTS5 query: each word becomes a quoted prefix
 * term, so `AND`, `NOT`, `NEAR(`, `*` and unbalanced quotes from a user (or a
 * message body) can never reach the query parser.
 */
export function toFtsQuery(input: string): string | null {
	const tokens = input
		.toLowerCase()
		.split(/[^\p{L}\p{N}_]+/u)
		.filter((token) => token.length > 0);

	if (tokens.length === 0) {
		return null;
	}

	return tokens.map((token) => `"${token.replaceAll('"', '""')}"*`).join(" ");
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
					SELECT id, conversation_id, author, body, sent_at, is_outgoing, is_deleted
					FROM messages
					WHERE conversation_id = ?1
					ORDER BY sent_at DESC, id DESC
					LIMIT ?2
				 ) ORDER BY sent_at ASC, id ASC`,
			)
			.all(conversationId, limit);
		return rows.map(toMessage);
	}

	async search(query: string, limit = this.#searchLimit): Promise<readonly Message[]> {
		const ftsQuery = toFtsQuery(query);
		if (ftsQuery === null || limit <= 0) {
			return [];
		}
		const rows = this.#db
			.query<MessageRow, [string, number]>(
				`SELECT m.id, m.conversation_id, m.author, m.body, m.sent_at, m.is_outgoing, m.is_deleted
				 FROM messages_fts
				 JOIN messages m ON m.rowid = messages_fts.rowid
				 WHERE messages_fts MATCH ?1
				 ORDER BY bm25(messages_fts), m.sent_at DESC
				 LIMIT ?2`,
			)
			.all(ftsQuery, limit);
		return rows.map(toMessage);
	}

	async upsertConversation(conversation: Conversation): Promise<void> {
		this.#db
			.query<null, [string, string, number, number]>(
				`INSERT INTO conversations (id, name, unread_count, last_activity_at)
				 VALUES (?1, ?2, ?3, ?4)
				 ON CONFLICT(id) DO UPDATE SET
					name = excluded.name,
					unread_count = excluded.unread_count,
					last_activity_at = MAX(conversations.last_activity_at, excluded.last_activity_at)`,
			)
			.run(
				conversation.id,
				conversation.name,
				conversation.unreadCount,
				conversation.lastActivityAt,
			);
	}

	async saveMessage(message: Message): Promise<void> {
		this.#db
			.query<null, [string, string, string, string, number, number, number]>(
				`INSERT INTO messages (id, conversation_id, author, body, sent_at, is_outgoing, is_deleted)
				 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
				 ON CONFLICT(id) DO UPDATE SET
					author = excluded.author,
					body = excluded.body,
					sent_at = excluded.sent_at,
					is_outgoing = excluded.is_outgoing,
					is_deleted = excluded.is_deleted`,
			)
			.run(
				message.id,
				message.conversationId,
				message.author,
				message.body,
				message.sentAt,
				message.isOutgoing ? 1 : 0,
				message.isDeleted ? 1 : 0,
			);
	}

	close(): void {
		this.#db.close();
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
