import type { Database } from "bun:sqlite";
import type { Attachment, Message } from "../../domain/types";

interface AttachmentRow {
	message_id: string;
	position: number;
	id: string | null;
	content_type: string | null;
	filename: string | null;
	size: number | null;
	caption: string | null;
	is_voice_note: number;
}

export function toAttachment(row: AttachmentRow): Attachment {
	return {
		id: row.id,
		contentType: row.content_type,
		filename: row.filename,
		size: row.size,
		caption: row.caption,
		isVoiceNote: row.is_voice_note === 1,
	};
}

/**
 * Files for a page of messages, in one query. Asking per message would turn a
 * 50-message page into 51 round trips.
 */
export function loadAttachments(
	db: Database,
	messageIds: readonly string[],
): Map<string, Attachment[]> {
	const byMessage = new Map<string, Attachment[]>();
	if (messageIds.length === 0) {
		return byMessage;
	}
	const placeholders = messageIds.map((_, index) => `?${index + 1}`).join(", ");
	const rows = db
		.query<AttachmentRow, string[]>(
			`SELECT message_id, position, id, content_type, filename, size, caption, is_voice_note
			 FROM attachments
			 WHERE message_id IN (${placeholders})
			 ORDER BY message_id, position`,
		)
		.all(...messageIds);

	for (const row of rows) {
		const list = byMessage.get(row.message_id) ?? [];
		list.push(toAttachment(row));
		byMessage.set(row.message_id, list);
	}
	return byMessage;
}

/**
 * Makes the stored rows match the message's list. An absent `attachments` field
 * means "we know nothing about files", so rows written by an earlier envelope
 * stay instead of being wiped by a partial update.
 */
export function replaceAttachments(db: Database, message: Message): void {
	const attachments = message.attachments;
	if (attachments === undefined) {
		return;
	}
	db.query<null, [string]>("DELETE FROM attachments WHERE message_id = ?1").run(message.id);

	const insert = db.query<
		null,
		[
			string,
			number,
			string | null,
			string | null,
			string | null,
			number | null,
			string | null,
			number,
		]
	>(
		`INSERT INTO attachments (message_id, position, id, content_type, filename, size, caption, is_voice_note)
		 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
	);
	attachments.forEach((attachment, position) => {
		insert.run(
			message.id,
			position,
			attachment.id,
			attachment.contentType,
			attachment.filename,
			attachment.size,
			attachment.caption,
			attachment.isVoiceNote ? 1 : 0,
		);
	});
}

/** A deleted message must not keep pointing at files. */
export function deleteAttachments(db: Database, messageId: string): void {
	db.query<null, [string]>("DELETE FROM attachments WHERE message_id = ?1").run(messageId);
}
