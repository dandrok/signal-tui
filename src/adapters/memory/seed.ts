import type { Conversation, Message, Reaction } from "../../domain/types";
import { demoConversations, demoMessages } from "./demo-data";

/**
 * How the in-memory store starts, and how a row comes back out of it.
 *
 * Both are "the demo half" of the adapter: the seeding that makes `--demo` work, and the
 * shaping that makes a memory row look like a SQLite row (a file array always present,
 * reactions only when there are some).
 */

export interface InMemoryStoreOptions {
	/**
	 * Start with the demo thread. On by default, because `--demo` and every frame test rely on
	 * it; a test that seeds its own conversation turns it off so the selection it asserts
	 * about is the one it wrote.
	 */
	readonly seed?: boolean;
}

export interface InitialContent {
	readonly conversations: Conversation[];
	readonly messages: Message[];
}

export function initialContent(options: InMemoryStoreOptions): InitialContent {
	const seeded = options.seed ?? true;
	return {
		conversations: seeded ? [...demoConversations] : [],
		messages: seeded ? [...demoMessages] : [],
	};
}

/** Same shape the SQLite adapter returns: always a file array, reactions only when present. */
export function hydrate(message: Message, reactions: readonly Reaction[] | undefined): Message {
	return {
		...message,
		isEdited: message.isEdited === true,
		attachments: message.attachments ?? [],
		...(reactions === undefined || reactions.length === 0 ? {} : { reactions }),
	};
}
