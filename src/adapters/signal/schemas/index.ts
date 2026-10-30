/**
 * Payload schemas matching what signal-cli actually emits.
 *
 * Field names and requiredness were checked against signal-cli's JSON records
 * (`org.asamk.signal.json.*`), not guessed:
 *   JsonMention(name, number, uuid, start, length)
 *   JsonReaction(emoji, targetAuthor, targetAuthorNumber, targetAuthorUuid, targetSentTimestamp, isRemove)
 *   JsonTypingMessage(action, timestamp, groupId)
 *   JsonAttachment(contentType, filename, id, size, width, height, caption, uploadTimestamp, isVoiceNote)
 *   JsonQuote(id, author, authorNumber, authorUuid, text, mentions, attachments)
 *   JsonMessageEnvelope(…, dataMessage, editMessage, storyMessage, syncMessage, callMessage, receiptMessage, typingMessage)
 *
 * Two rules that follow from those records:
 *  - `.nullish()` (not `.optional()`) for anything signal-cli emits as `null`,
 *    e.g. `sourceNumber` for a hidden number, an attachment's `filename`, or a
 *    message with no text;
 *  - `editMessage` lives on the envelope, next to `dataMessage`, never inside it.
 *
 * Objects are `.loose()` on purpose: unknown keys from newer signal-cli releases
 * must never fail a real message.
 *
 * The payload schemas (a message's own content) and the envelope schemas (what wraps it)
 * are two files because they change for different reasons: Signal adds fields to a data
 * message far more often than it changes the envelope around it. This file is the module's
 * public surface — import schemas and types from `./schemas`, never from a file below it.
 */
export * from "./contacts";
export * from "./envelope";
export * from "./payload";
export type {
	Attachment,
	CallMessage,
	DataMessage,
	EditMessage,
	Envelope,
	Mention,
	Quote,
	QuotedAttachment,
	Reaction,
	ReceiptMessage,
	ReceiveEnvelope,
	SentMessage,
	SyncMessage,
	TypingMessage,
} from "./types";
