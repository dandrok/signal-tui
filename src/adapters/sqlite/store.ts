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
import { deleteAttachments } from "./attachments";
import { addUnread, clearUnread, readExpiresInSeconds, upsertConversation } from "./conversations";
import { hydrateMessages } from "./hydrate";
import { applyEditRow, applyReceiptRows, hideMessageRow, purgeExpiredRows } from "./message-rules";
import { restrictCachePermissions } from "./private-cache";
import { applyReactionRow, deleteReactions } from "./reactions";
import {
	readAllMessages,
	readConversations,
	readMessages,
	readMessagesBefore,
	searchMessages,
} from "./read-messages";
import { toConversation, toMessage } from "./rows";
import { saveMessageRow } from "./save-message";
import { migrate, readSchemaVersion } from "./schema";

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
			migrate(this.#db);
		} catch (error) {
			// Construction failed, so the caller never gets an instance to close.
			this.#db.close();
			throw error;
		}
	}

	/** Applied schema version, useful for `doctor` output and tests. */
	get schemaVersion(): number {
		return readSchemaVersion(this.#db);
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
		return hydrateMessages(this.#db, readMessages(this.#db, conversationId, limit).map(toMessage));
	}

	async listMessagesBefore(
		conversationId: ConversationId,
		beforeSentAt: number,
		limit = this.#messageLimit,
	): Promise<readonly Message[]> {
		if (limit <= 0) {
			return [];
		}
		return hydrateMessages(
			this.#db,
			readMessagesBefore(this.#db, conversationId, beforeSentAt, limit).map(toMessage),
		);
	}

	async listAllMessages(conversationId: ConversationId): Promise<readonly Message[]> {
		return hydrateMessages(this.#db, readAllMessages(this.#db, conversationId).map(toMessage));
	}

	async search(query: string, limit = this.#searchLimit): Promise<readonly Message[]> {
		return hydrateMessages(this.#db, searchMessages(this.#db, query, limit).map(toMessage));
	}

	async upsertConversation(conversation: Conversation): Promise<void> {
		upsertConversation(this.#db, conversation);
	}

	async expiresInSeconds(conversationId: ConversationId): Promise<number | undefined> {
		return readExpiresInSeconds(this.#db, conversationId);
	}

	async incrementUnread(conversationId: ConversationId, by: number): Promise<void> {
		addUnread(this.#db, conversationId, by);
	}

	async markConversationRead(conversationId: ConversationId): Promise<boolean> {
		return clearUnread(this.#db, conversationId);
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

	async hideMessage(conversationId: ConversationId, messageId: MessageId): Promise<boolean> {
		return hideMessageRow(this.#db, conversationId, messageId);
	}

	close(): void {
		this.#db.close();
	}
}
