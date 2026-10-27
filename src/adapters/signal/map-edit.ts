import type { ConversationId, EditAuthor } from "../../domain/types";
import { type ConversationKind, groupTarget, type Target } from "./map-target";
import { dataMessageSchema, type EditMessage } from "./schemas";
import { textOf } from "./text";

/**
 * The replacement a correction carries, and where it lands.
 *
 * Two payloads carry one: a peer's edit (`envelope.editMessage`) and one of our own edits
 * echoed from another device (inside `syncMessage.sentMessage`). Both hold a *copy* of the
 * data message with the correction inside it, so the conversation comes from that inner
 * message's group info and falls back to the conversation the payload addressed. One rule
 * for both, because a second copy of "which message is this about" is how the two paths
 * drift apart.
 */
export interface MappedEdit {
	readonly conversationId: ConversationId;
	readonly conversationKind: ConversationKind;
	readonly targetSentAt: number;
	readonly editor: EditAuthor;
	readonly body: string;
}

/**
 * Only real text may replace a body.
 *
 * `bodyOf` answers "[attachment]" for a data message that carries files and nothing else,
 * so composing an edit from it would paste a placeholder over what the peer wrote. A
 * caption counts — that is where a photo's words live — and an edit with no text at all is
 * ignored rather than blanking the message, because an edit to nothing is not a thing
 * Signal produces.
 */
export function mapEditPayload(
	edit: EditMessage,
	target: Target,
	editor: EditAuthor,
): MappedEdit | null {
	const parsed =
		edit.dataMessage === null || edit.dataMessage === undefined
			? null
			: dataMessageSchema.safeParse(edit.dataMessage);
	const data = parsed?.success === true ? parsed.data : undefined;
	const conversation =
		data?.groupInfo === undefined ? target : (groupTarget(data.groupInfo) ?? target);
	const body = data === undefined ? "" : textOf(data);

	if (body.length === 0) {
		return null;
	}

	return {
		conversationId: conversation.id,
		conversationKind: conversation.kind,
		targetSentAt: edit.targetSentTimestamp,
		editor,
		body,
	};
}
