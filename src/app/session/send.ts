import { SELF_LABEL } from "../../domain/format";
import type { ConversationId } from "../../domain/types";
import { SELF_AUTHOR_ID } from "../../domain/types";
import type { ReplyTarget } from "../../ports/backend";
import type { SentFile, SessionContext } from "./types";

/**
 * Sends a message and writes the local echo.
 *
 * Signal does not send a transcript back to the device that wrote the message, so without
 * the echo your own message never appears. The server timestamp is the message's identity
 * everywhere else, which is what lets a delete-for-everyone from another device match it.
 *
 * A file rides along as a path the engine reads from this machine, and the echo keeps that path
 * as the attachment's `filename` — the same field a received file uses, because the pane splits
 * it for display and a later `o` needs the path, not a name. The body may be empty: the wire
 * allows an attachment with no words, and refusing that would make "send this photo" impossible.
 */
export async function sendText(
	context: SessionContext,
	conversationId: ConversationId,
	body: string,
	replyTo?: ReplyTarget,
	file?: SentFile,
): Promise<void> {
	const { timestamp } = await context.backend.sendMessage(
		conversationId,
		body,
		replyTo,
		file?.path,
	);

	const sentAt = timestamp ?? Date.now();
	// Signal never echoes our own message back, so its expiry has to come from the
	// conversation timer the cache learned from incoming traffic.
	const timer = await context.store.expiresInSeconds(conversationId);

	const written = context.enqueue(async () => {
		await context.store.upsertConversation({
			id: conversationId,
			name: "",
			unreadCount: 0,
			lastActivityAt: sentAt,
		});
		await context.store.saveMessage({
			id: `${conversationId}:${sentAt}`,
			conversationId,
			author: SELF_LABEL,
			// Without this the row has no id and an edit would be matched on the label
			// alone — a group member whose display name is "You" could then replace our
			// message at the same timestamp.
			authorId: SELF_AUTHOR_ID,
			body,
			sentAt,
			isOutgoing: true,
			isDeleted: false,
			// Our own reply carries the marker too, so the row draws what it answers
			// without waiting for the transcript Signal never sends back to us. Only the
			// identity is stored — the text is read from the quoted message.
			...(replyTo === undefined
				? {}
				: { quote: { sentAt: replyTo.sentAt, authorId: replyTo.authorId } }),
			...(file === undefined
				? {}
				: {
						attachments: [
							{
								id: null,
								contentType: null,
								filename: file.path,
								size: file.size,
								caption: null,
								isVoiceNote: false,
							},
						],
					}),
			...(timer === undefined || timer <= 0 ? {} : { expiresAt: sentAt + timer * 1000 }),
		});
		context.notify();
	});

	await written;
}
