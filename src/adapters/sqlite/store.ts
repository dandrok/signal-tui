import { Database } from "bun:sqlite";
import type {
	Conversation,
	ConversationId,
	EditAuthor,
	Message,
	MessageId,
	Reaction,
	ReceiptState,
} from "../../domain/types";
import type { MessageStore } from "../../ports/store";
import { deleteAttachments, loadAttachments } from "./attachments";
import { applyEditRow, applyReceiptRows, purgeExpiredRows } from "./message-rules";
import { migrations } from "./migrations";
import { restrictCachePermissions } from "./private-cache";
import { applyReactionRow, deleteReactions, loadReactions } from "./reactions";
import {
	readAllMessages,
	readConversations,
	readMessages,
	readMessagesBefore,
	searchMessages,
} from "./read-messages";
import { toConversation, toMessage } from "./rows";
import { saveMessageRow } from "./save-message";

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
		return this.#hydrate(readMessages(this.#db, conversationId, limit).map(toMessage));
	}

	async listMessagesBefore(
		conversationId: ConversationId,
		beforeSentAt: number,
		limit = this.#messageLimit,
	): Promise<readonly Message[]> {
		if (limit <= 0) {
			return [];
		}
		return this.#hydrate(
			readMessagesBefore(this.#db, conversationId, beforeSentAt, limit).map(toMessage),
		);
	}

	async listAllMessages(conversationId: ConversationId): Promise<readonly Message[]> {
		return this.#hydrate(readAllMessages(this.#db, conversationId).map(toMessage));
	}

	async search(query: string, limit = this.#searchLimit): Promise<readonly Message[]> {
		return this.#hydrate(searchMessages(this.#db, query, limit).map(toMessage));
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
		return saveMessageRow(this.#db, message);
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

	async applyReaction(
		conversationId: ConversationId,
		targetSentAt: number,
		reaction: Reaction,
		isRemove: boolean,
	): Promise<boolean> {
		return applyReactionRow(this.#db, conversationId, targetSentAt, reaction, isRemove);
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
			// deleted message should not keep pointing at them — nor keep reactions to
			// text that is gone.
			deleteAttachments(this.#db, messageId);
			deleteReactions(this.#db, messageId);
		})();
	}

	close(): void {
		this.#db.close();
	}

	#hydrate(messages: readonly Message[]): readonly Message[] {
		if (messages.length === 0) {
			return messages;
		}
		const ids = messages.map((message) => message.id);
		const files = loadAttachments(this.#db, ids);
		const reactions = loadReactions(this.#db, ids);
		return messages.map((message) => {
			const own = reactions.get(message.id);
			return {
				...message,
				// Files are always an array on the way out, even when empty: a caller reading
				// a message should not have to distinguish "no files" from "field absent".
				attachments: files.get(message.id) ?? [],
				// Reactions are absent when nobody reacted: unlike a file list, they accumulate
				// after the message arrives, and an empty array on every row would be noise.
				...(own === undefined ? {} : { reactions: own }),
			};
		});
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
