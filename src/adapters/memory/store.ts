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
import { addUnread, clearUnread, mergeConversation, readExpiresInSeconds } from "./conversations";
import { deleteIn, editIn, purgeIn, reactIn, receiptIn, saveInto } from "./message-rules";
import {
	DEFAULT_LIMIT,
	readAllMessages,
	readConversations,
	readMessages,
	readMessagesBefore,
	searchMessages,
} from "./read";
import { type InMemoryStoreOptions, initialContent } from "./seed";

/**
 * Test/demo store, shape-compatible with the SQLite adapter: the same five reads, the same
 * conversation rules and the same message rules, written over arrays instead of SQL.
 *
 * This class only holds the arrays and hands them over. `read.ts` answers the queries,
 * `conversations.ts` owns thread metadata, `message-rules.ts` owns everything that decides
 * what a message becomes on replay, an edit, a reaction, an expiry or a delete — the split the
 * SQLite adapter already had, so the two can be compared function by function.
 */
export class InMemoryStore implements MessageStore {
	#conversations: Conversation[];
	#messages: Message[];
	/** Keyed by message id: reactions arrive after the message, one list per message. */
	#reactions: Map<string, readonly Reaction[]> = new Map();

	constructor(options: InMemoryStoreOptions = {}) {
		const { conversations, messages } = initialContent(options);
		this.#conversations = conversations;
		this.#messages = messages;
	}

	async listConversations(): Promise<readonly Conversation[]> {
		return readConversations(this.#conversations);
	}

	async listMessages(
		conversationId: ConversationId,
		limit = DEFAULT_LIMIT,
	): Promise<readonly Message[]> {
		return readMessages(this.#messages, this.#reactions, conversationId, limit);
	}

	async listMessagesBefore(
		conversationId: ConversationId,
		beforeSentAt: number,
		limit = DEFAULT_LIMIT,
	): Promise<readonly Message[]> {
		return readMessagesBefore(this.#messages, this.#reactions, conversationId, beforeSentAt, limit);
	}

	async listAllMessages(conversationId: ConversationId): Promise<readonly Message[]> {
		return readAllMessages(this.#messages, this.#reactions, conversationId);
	}

	async search(query: string, limit = 20): Promise<readonly Message[]> {
		return searchMessages(this.#messages, this.#reactions, query, limit);
	}

	async upsertConversation(conversation: Conversation): Promise<void> {
		this.#conversations = mergeConversation(this.#conversations, conversation);
	}

	async expiresInSeconds(conversationId: ConversationId): Promise<number | undefined> {
		return readExpiresInSeconds(this.#conversations, conversationId);
	}

	async incrementUnread(conversationId: ConversationId, by: number): Promise<void> {
		this.#conversations = addUnread(this.#conversations, conversationId, by);
	}

	async markConversationRead(conversationId: ConversationId): Promise<boolean> {
		const { conversations, changed } = clearUnread(this.#conversations, conversationId);
		this.#conversations = conversations;
		return changed;
	}

	async saveMessage(message: Message): Promise<{ readonly inserted: boolean }> {
		const { messages, inserted } = saveInto(this.#messages, message);
		this.#messages = [...messages];
		return { inserted };
	}

	async applyEdit(
		conversationId: ConversationId,
		targetSentAt: number,
		editor: EditAuthor,
		body: string,
	): Promise<boolean> {
		const { messages, changed } = editIn(
			this.#messages,
			conversationId,
			targetSentAt,
			editor,
			body,
		);
		this.#messages = [...messages];
		return changed;
	}

	async purgeExpired(now: number): Promise<number> {
		const { messages, purged, dropped } = purgeIn(this.#messages, now);
		this.#messages = [...messages];
		for (const id of dropped) {
			this.#reactions.delete(id);
		}
		return purged;
	}

	async applyReaction(
		conversationId: ConversationId,
		targetSentAt: number,
		reaction: Reaction,
		isRemove: boolean,
	): Promise<boolean> {
		const { reactions, changed } = reactIn(
			this.#reactions,
			this.#messages,
			conversationId,
			targetSentAt,
			reaction,
			isRemove,
		);
		this.#reactions = new Map(reactions);
		return changed;
	}

	async markMessageDeleted(conversationId: ConversationId, messageId: MessageId): Promise<void> {
		const { messages, dropped } = deleteIn(this.#messages, conversationId, messageId);
		this.#messages = [...messages];
		for (const id of dropped) {
			this.#reactions.delete(id);
		}
	}

	async applyReceipt(
		timestamps: readonly number[],
		state: ReceiptState,
	): Promise<readonly ConversationId[]> {
		const { messages, changed } = receiptIn(this.#messages, timestamps, state);
		this.#messages = [...messages];
		return changed;
	}
}
