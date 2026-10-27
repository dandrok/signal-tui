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
 * The conversation a correction lands in, and the words that replace it.
 *
 * `target` is nullable because a synced edit to a group message arrives with no
 * destination at all — the group comes from the edit's own data message — so the rule
 * has to be able to say "the inner group is the answer" before anyone decides the
 * payload named no conversation.
 *
 * Only real text may replace a body: `bodyOf` answers "[attachment]" for a data message
 * that carries files and nothing else, so building an edit from it would paste a
 * placeholder over what the peer wrote. A caption counts — that is where a photo's words
 * live — and an edit with no text is ignored rather than blanking the message.
 */
export function mapEditPayload(
	edit: EditMessage,
	target: Target | null,
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

	if (conversation === null || body.length === 0) {
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
