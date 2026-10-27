import type { Database } from "bun:sqlite";
import type { Message } from "../../domain/types";
import { loadAttachments } from "./attachments";
import { loadReactions } from "./reactions";

/**
 * Turns message rows into messages, in two queries rather than two per row.
 *
 * The asymmetry is deliberate and belongs in one place: `attachments` is always an array on
 * the way out, even when empty, because a caller should not have to distinguish "no files"
 * from "field absent"; `reactions` is absent when nobody reacted, because they accumulate
 * after the message arrives and an empty array on every row would be noise.
 */
export function hydrateMessages(db: Database, messages: readonly Message[]): readonly Message[] {
	if (messages.length === 0) {
		return messages;
	}
	const ids = messages.map((message) => message.id);
	const files = loadAttachments(db, ids);
	const reactions = loadReactions(db, ids);
	return messages.map((message) => {
		const own = reactions.get(message.id);
		return {
			...message,
			attachments: files.get(message.id) ?? [],
			...(own === undefined ? {} : { reactions: own }),
		};
	});
}
