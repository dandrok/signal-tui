import type { ConversationId } from "../../../domain/types";
import type { BackendEvent } from "../../../ports/backend";
import { type MappedEnvelope, mapEnvelope } from "../map-envelope";
import { receiveEnvelopeSchema } from "../schemas";

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

/** Where one accepted notification goes: the error log, the group book, the listeners. */
export interface EnvelopeSink {
	readonly record: (reason: string) => void;
	readonly addGroup: (conversationId: ConversationId) => void;
	readonly emit: (event: BackendEvent) => void;
}

/**
 * One notification, from wire params to events: the whole receive path, in the order it has to
 * happen. A notification of another kind is not ours (the client may be shared), a payload that
 * does not parse is recorded rather than thrown, and the group is registered before its events
 * are delivered — a send that answers this message needs the id.
 */
export function acceptNotification(
	method: string,
	params: unknown,
	expected: string,
	sink: EnvelopeSink,
): void {
	if (method !== expected) {
		return;
	}
	const parsed = receiveEnvelopeSchema.safeParse(unwrapNotification(params));
	if (!parsed.success) {
		sink.record(`invalid envelope: ${parsed.error.issues[0]?.message ?? "unknown"}`);
		return;
	}
	const mapped = mapEnvelope(parsed.data.envelope);
	const groupId = groupConversationOf(mapped);
	if (groupId !== null) {
		sink.addGroup(groupId);
	}
	for (const event of eventsFrom(mapped)) {
		sink.emit(event);
	}
}
