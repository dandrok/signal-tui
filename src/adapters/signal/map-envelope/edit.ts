import type { EditAuthor } from "../../../domain/types";
import { mapEditPayload } from "../map-edit";
import { conversationTarget, peerId, peerName, type Target } from "../map-target";
import type { EditMessage, Envelope } from "../schemas";
import { EMPTY, type MappedEnvelope } from "./types";

/**
 * An edit, wrapped as an event rather than a message. The rule that decides which conversation
 * it lands in, and whether it carries real text, lives in `map-edit.ts`; this only says who
 * asked and turns the answer into an envelope.
 */
export function editEnvelope(
	edit: EditMessage,
	target: Target | null,
	editor: EditAuthor,
): MappedEnvelope {
	const mapped = mapEditPayload(edit, target, editor);
	if (mapped === null) {
		return target === null ? EMPTY : { ...EMPTY, conversationKind: target.kind };
	}
	return {
		...EMPTY,
		conversationKind: mapped.conversationKind,
		edited: {
			conversationId: mapped.conversationId,
			targetSentAt: mapped.targetSentAt,
			editor: mapped.editor,
			body: mapped.body,
		},
	};
}

/**
 * An incoming edit: the envelope's sender is the editor. The destination is resolved before
 * anything else, because an edit that names a conversation the cache does not know is still an
 * edit — it just has nowhere to land.
 */
export function mapEdit(envelope: Envelope, edit: EditMessage): MappedEnvelope {
	const target = conversationTarget(envelope);
	if (target === null) {
		return EMPTY;
	}
	return editEnvelope(edit, target, { id: peerId(envelope), label: peerName(envelope) });
}
