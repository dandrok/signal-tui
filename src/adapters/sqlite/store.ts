import { Database } from "bun:sqlite";
import type {
	Conversation,
	ConversationId,
	EditAuthor,
	Message,
	MessageId,
	ReceiptState,
} from "../../domain/types";
import type { MessageStore } from "../../ports/store";
import { deleteAttachments, loadAttachments, replaceAttachments } from "./attachments";
import { applyEditRow, applyReceiptRows, purgeExpiredRows } from "./message-rules";
import { migrations } from "./migrations";
import { restrictCachePermissions } from "./private-cache";
import { readAllMessages, readConversations, readMessages, searchMessages } from "./read-messages";
import { toConversation, toMessage } from "./rows";

const DEFAULT_MESSAGE_LIMIT = 50;
const DEFAULT_SEARCH_LIMIT = 20;

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
		return readConversations(this.#db).map(toConversation);
	}

	async listMessages(
		conversationId: ConversationId,
		limit = this.#messageLimit,
	): Promise<readonly Message[]> {
		if (limit <= 0) {
			return [];
		}
		return this.#withAttachments(readMessages(this.#db, conversationId, limit).map(toMessage));
	}

	async listAllMessages(conversationId: ConversationId): Promise<readonly Message[]> {
		return this.#withAttachments(readAllMessages(this.#db, conversationId).map(toMessage));
	}

	async search(query: string, limit = this.#searchLimit): Promise<readonly Message[]> {
		return this.#withAttachments(searchMessages(this.#db, query, limit).map(toMessage));
	}

	async upsertConversation(conversation: Conversation): Promise<void> {
		this.#db
			.query<null, [string, string, number, number, number | null]>(
				// A payload that carries no timer says nothing about the timer, so the stored
				// one survives: COALESCE, not a default of zero.
				`INSERT INTO conversations (id, name, unread_count, last_activity_at, expires_in_seconds)
				 VALUES (?1, ?2, ?3, ?4, ?5)
				 ON CONFLICT(id) DO UPDATE SET
					name = CASE WHEN TRIM(excluded.name) = '' THEN conversations.name ELSE excluded.name END,
					last_activity_at = MAX(conversations.last_activity_at, excluded.last_activity_at),
					expires_in_seconds = COALESCE(excluded.expires_in_seconds, conversations.expires_in_seconds)`,
			)
			.run(
				conversation.id,
				conversation.name,
				conversation.unreadCount,
				conversation.lastActivityAt,
				conversation.expiresInSeconds ?? null,
			);
	}

	async expiresInSeconds(conversationId: ConversationId): Promise<number | undefined> {
		const row = this.#db
			.query<{ expires_in_seconds: number | null }, [string]>(
				"SELECT expires_in_seconds FROM conversations WHERE id = ?1",
			)
			.get(conversationId);
		return row?.expires_in_seconds ?? undefined;
	}

	async incrementUnread(conversationId: ConversationId, by: number): Promise<void> {
		this.#db
			.query<null, [number, string]>(
				"UPDATE conversations SET unread_count = unread_count + ?1 WHERE id = ?2",
			)
			.run(by, conversationId);
	}

	async markConversationRead(conversationId: ConversationId): Promise<boolean> {
		// The guard makes the result meaningful: an already-read conversation reports no
		// change, which is what stops the UI feedback loop. RETURNING states that
		// exactly, without leaning on the driver's change counter.
		const updated = this.#db
			.query<{ id: string }, [string]>(
				`UPDATE conversations SET unread_count = 0
				 WHERE id = ?1 AND unread_count > 0
				 RETURNING id`,
			)
			.all(conversationId);
		return updated.length > 0;
	}

	async saveMessage(message: Message): Promise<{ readonly inserted: boolean }> {
		type SaveParams = [
			string,
			string,
			string,
			string | null,
			string,
			number,
			number,
			number,
			number | null,
		];
		const params: SaveParams = [
			message.id,
			message.conversationId,
			message.author,
			message.authorId ?? null,
			message.body,
			message.sentAt,
			message.isOutgoing ? 1 : 0,
			message.isDeleted ? 1 : 0,
			message.expiresAt ?? null,
		];

		// One write on the common path: a message seen once is inserted, and only a
		// replay or an edit falls through to the update. The transaction keeps the
		// message and its attachment rows from ever disagreeing.
		const inserted = this.#db.transaction(() => {
			// `ON CONFLICT DO NOTHING RETURNING id` answers "was it inserted" exactly: a
			// conflict returns no row, an insert returns one. A change counter would make
			// an existing message look new on some builds, which skips the update below
			// and loses whatever the replay was carrying.
			const insertedRows = this.#db
				.query<{ id: string }, SaveParams>(
					`INSERT INTO messages (id, conversation_id, author, author_id, body, sent_at, is_outgoing, is_deleted, is_edited, expires_at)
					 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0, ?9)
					 ON CONFLICT(id) DO NOTHING
					 RETURNING id`,
				)
				.all(...params);
			const changes = insertedRows.length;

			if (changes === 0) {
				this.#db
					.query<null, SaveParams>(
						// One rule with three faces: once a message is gone or corrected,
						// a redelivered envelope must not put the old text back. Deletion
						// (Signal has no undelete), expiry (the timer already ran), and an
						// edit (a correction outranks the original) all freeze the body.
						`UPDATE messages SET author = ?3,
						        author_id = COALESCE(?4, author_id),
						        body = CASE
						                 WHEN is_deleted = 1 THEN body
						                 WHEN is_expired = 1 THEN body
						                 WHEN is_edited = 1 THEN body
						                 ELSE ?5
						               END,
						        sent_at = ?6, is_outgoing = ?7,
						        is_deleted = is_deleted | ?8,
					        -- The deadline is the promise made when the message was stored.
					        -- A replay may supply one where none was known (NULL), and may
					        -- never push out one that exists: that would extend the lifetime
					        -- of a message the sender already expected to be gone.
					        expires_at = COALESCE(expires_at, ?9)
						 WHERE id = ?1 AND conversation_id = ?2`,
					)
					.run(...params);
			}

			// Files follow the same rule: a tombstone keeps none, whether it was deleted or
			// expired, or a replay would put the rows back on a message that is gone.
			const row = this.#db
				.query<{ is_deleted: number; is_expired: number }, [string]>(
					"SELECT is_deleted, is_expired FROM messages WHERE id = ?1",
				)
				.get(message.id);
			if (row === null || (row.is_deleted !== 1 && row.is_expired !== 1)) {
				replaceAttachments(this.#db, message);
			}
			return changes;
		})();

		return { inserted: inserted > 0 };
	}

	async applyEdit(
		conversationId: ConversationId,
		targetSentAt: number,
		editor: EditAuthor,
		body: string,
	): Promise<boolean> {
		return applyEditRow(this.#db, conversationId, targetSentAt, editor, body);
	}

	async purgeExpired(now: number): Promise<number> {
		return purgeExpiredRows(this.#db, now);
	}

	async applyReceipt(
		timestamps: readonly number[],
		state: ReceiptState,
	): Promise<readonly ConversationId[]> {
		if (timestamps.length === 0) {
			return [];
		}
		return applyReceiptRows(this.#db, timestamps, state);
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
