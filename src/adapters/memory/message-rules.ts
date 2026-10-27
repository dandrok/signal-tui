import { strongerReceipt } from "../../domain/receipts";
import type {
	ConversationId,
	EditAuthor,
	Message,
	MessageId,
	Reaction,
	ReceiptState,
} from "../../domain/types";
import { mergeMessage } from "./merge-message";

/**
 * The write half of the in-memory store: every rule the SQLite adapter states as SQL, stated
 * over arrays. Each function takes what the store owns and returns its replacement, so the
 * store stays a thin holder and a rule can be read (and tested) without constructing one.
 *
 * `dropped` is the store's cue to forget reactions: a message that is gone should not keep a
 * 👍 on it, and the arrays cannot express that the way a foreign key does.
 */

export interface Saved {
	readonly messages: readonly Message[];
	readonly inserted: boolean;
}

export function saveInto(messages: readonly Message[], message: Message): Saved {
	const index = messages.findIndex((existing) => existing.id === message.id);
	const existing = messages[index];
	if (existing === undefined) {
		// A view-once message keeps no content, however it was handed over.
		const stored =
			message.isViewOnce === true ? { ...message, body: "", attachments: [] } : message;
		return { messages: [...messages, stored], inserted: true };
	}
	// Every replay rule lives in `mergeMessage`, so this adapter and the SQLite one agree.
	const next = [...messages];
	next[index] = mergeMessage(existing, message);
	return { messages: next, inserted: false };
}

export function editIn(
	messages: readonly Message[],
	conversationId: ConversationId,
	targetSentAt: number,
	editor: EditAuthor,
	body: string,
): { readonly messages: readonly Message[]; readonly changed: boolean } {
	// A timestamp identifies a message within a conversation, not an author, so the author
	// has to match too — otherwise one member's edit could rewrite another member's message.
	// Rows stored before schema v4 have no id: they fall back to the label they were cached
	// with, exactly as the SQLite adapter does.
	const index = messages.findIndex(
		(entry) =>
			entry.conversationId === conversationId &&
			entry.sentAt === targetSentAt &&
			(entry.authorId === undefined ? entry.author === editor.label : entry.authorId === editor.id),
	);
	const existing = messages[index];
	// An expired message is gone on purpose, a deleted one is gone for everyone, and a
	// view-once one was never kept; none may be refilled by an edit that arrives late.
	if (
		existing === undefined ||
		existing.isDeleted ||
		existing.isExpired === true ||
		existing.isViewOnce === true
	) {
		return { messages, changed: false };
	}
	const next = [...messages];
	next[index] = { ...existing, body, isEdited: true };
	return { messages: next, changed: true };
}

export function purgeIn(
	messages: readonly Message[],
	now: number,
): {
	readonly messages: readonly Message[];
	readonly purged: number;
	readonly dropped: readonly MessageId[];
} {
	const dropped: MessageId[] = [];
	const next = messages.map((message) => {
		if (message.expiresAt === undefined || message.expiresAt > now || message.isExpired === true) {
			return message;
		}
		dropped.push(message.id);
		// Text, files and reactions all go: a message that is gone should not still name the
		// path of the photo it carried, nor keep a 👍 on it. The quote stays: it is the
		// identity of another message, holds none of this one's words, and the pane reads its
		// text from that row — which says "message expired" on its own.
		return { ...message, body: "", attachments: [], isExpired: true };
	});
	return { messages: next, purged: dropped.length, dropped };
}

export function reactIn(
	reactions: ReadonlyMap<string, readonly Reaction[]>,
	messages: readonly Message[],
	conversationId: ConversationId,
	targetSentAt: number,
	reaction: Reaction,
	isRemove: boolean,
): { readonly reactions: Map<string, readonly Reaction[]>; readonly changed: boolean } {
	// Same rules as the SQLite adapter: the message is found by conversation and timestamp,
	// one reaction per person replaces, removal deletes, and a message that is gone takes none.
	const target = messages.find(
		(entry) =>
			entry.conversationId === conversationId &&
			entry.sentAt === targetSentAt &&
			!entry.isDeleted &&
			entry.isExpired !== true,
	);
	if (target === undefined) {
		return { reactions: new Map(reactions), changed: false };
	}

	const next = new Map(reactions);
	const existing = next.get(target.id) ?? [];
	const mine = existing.find((entry) => entry.authorId === reaction.authorId);
	if (isRemove) {
		if (mine === undefined) {
			return { reactions: next, changed: false };
		}
		const left = existing.filter((entry) => entry.authorId !== reaction.authorId);
		if (left.length === 0) {
			next.delete(target.id);
		} else {
			next.set(target.id, left);
		}
		return { reactions: next, changed: true };
	}

	if (mine !== undefined && mine.emoji === reaction.emoji) {
		return { reactions: next, changed: false };
	}
	next.set(target.id, [
		...existing.filter((entry) => entry.authorId !== reaction.authorId),
		reaction,
	]);
	return { reactions: next, changed: true };
}

/**
 * A deleted message keeps its row and its quote marker, drops its text and files, and stops
 * pointing at anything on disk — the same three things the SQLite adapter does in one
 * transaction. `dropped` carries the id whose reactions go with it.
 */
export function deleteIn(
	messages: readonly Message[],
	conversationId: ConversationId,
	messageId: MessageId,
): { readonly messages: readonly Message[]; readonly dropped: readonly MessageId[] } {
	const index = messages.findIndex((message) => message.id === messageId);
	const existing = messages[index];
	if (existing === undefined || existing.conversationId !== conversationId) {
		return { messages, dropped: [] };
	}
	const next = [...messages];
	next[index] = { ...existing, isDeleted: true, body: "", attachments: [] };
	return { messages: next, dropped: [messageId] };
}

export function receiptIn(
	messages: readonly Message[],
	timestamps: readonly number[],
	state: ReceiptState,
): { readonly messages: readonly Message[]; readonly changed: readonly ConversationId[] } {
	// Same rules as the SQLite adapter, because this store is what demo mode and half the
	// tests run against: a receipt may only touch our own messages, and only to strengthen
	// what is stored.
	const wanted = new Set(timestamps);
	const changed = new Set<ConversationId>();
	const next = messages.map((message) => {
		if (!message.isOutgoing || !wanted.has(message.sentAt)) {
			return message;
		}
		const receipt = strongerReceipt(message.receipt, state);
		if (receipt === message.receipt) {
			return message;
		}
		changed.add(message.conversationId);
		return { ...message, receipt };
	});
	return { messages: next, changed: [...changed] };
}
