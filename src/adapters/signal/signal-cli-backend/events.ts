import type { ConversationId } from "../../../domain/types";
import type { BackendEvent } from "../../../ports/backend";
import type { MappedEnvelope } from "../map-envelope";

/**
 * From what a mapper said to what the app hears: one mapped envelope can be several events
 * (a message also updates its conversation), and each kind becomes its own.
 *
 * Its own file because it is the only place the two vocabularies meet — the adapter's
 * `MappedEnvelope` and the app's `BackendEvent` — and reading it is how you check that a new
 * kind of envelope actually reaches the session.
 */
export function eventsFrom(mapped: MappedEnvelope): readonly BackendEvent[] {
	const events: BackendEvent[] = [];
	if (mapped.conversation !== null) {
		events.push({ kind: "conversation-updated", conversation: mapped.conversation });
	}
	if (mapped.message !== null) {
		events.push({ kind: "message", message: mapped.message });
	}
	if (mapped.edited !== null) {
		events.push({
			kind: "message-edited",
			conversationId: mapped.edited.conversationId,
			targetSentAt: mapped.edited.targetSentAt,
			editor: mapped.edited.editor,
			body: mapped.edited.body,
		});
	}
	if (mapped.deleted !== null) {
		events.push({
			kind: "message-deleted",
			conversationId: mapped.deleted.conversationId,
			messageId: mapped.deleted.messageId,
		});
	}
	if (mapped.reaction !== null) {
		events.push({
			kind: "reaction",
			conversationId: mapped.reaction.conversationId,
			targetSentAt: mapped.reaction.targetSentAt,
			reactor: mapped.reaction.reactor,
			emoji: mapped.reaction.emoji,
			isRemove: mapped.reaction.isRemove,
		});
	}
	if (mapped.receipt !== null) {
		events.push({
			kind: "receipt",
			timestamps: mapped.receipt.timestamps,
			state: mapped.receipt.state,
		});
	}
	if (mapped.typing !== null) {
		events.push({
			kind: "typing",
			conversationId: mapped.typing.conversationId,
			author: mapped.typing.author,
			isTyping: mapped.typing.isTyping,
		});
	}
	return events;
}

/**
 * The conversation an envelope belongs to, when it is a group.
 *
 * Every event that names a conversation counts, reactions included: a reaction can be the
 * first thing this session sees from a group, and the set of known groups is what decides
 * whether a later send addresses the group by id or by a recipient that is not one.
 */
export function groupConversationOf(mapped: MappedEnvelope): ConversationId | null {
	if (mapped.conversationKind !== "group") {
		return null;
	}
	return (
		mapped.conversation?.id ??
		mapped.deleted?.conversationId ??
		mapped.edited?.conversationId ??
		mapped.reaction?.conversationId ??
		mapped.typing?.conversationId ??
		null
	);
}

/**
 * signal-cli wraps notifications differently per receive mode: automatic mode sends
 * `params.envelope`, manual mode (the default here) sends `params.result.envelope` inside a
 * subscription envelope. Both must parse.
 */
export function unwrapNotification(params: unknown): unknown {
	if (typeof params !== "object" || params === null) {
		return params;
	}
	const result = (params as { result?: unknown }).result;
	if (typeof result === "object" && result !== null && "envelope" in result) {
		return result;
	}
	return params;
}
