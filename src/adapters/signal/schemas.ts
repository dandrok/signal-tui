import { z } from "zod";

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
 */

export const attachmentSchema = z.looseObject({
	contentType: z.string(),
	isVoiceNote: z.boolean(),
	id: z.string().nullish(),
	filename: z.string().nullish(),
	size: z.number().int().nullish(),
	width: z.number().int().nullish(),
	height: z.number().int().nullish(),
	caption: z.string().nullish(),
	uploadTimestamp: z.number().int().nullish(),
});

export const mentionSchema = z.looseObject({
	start: z.number().int(),
	length: z.number().int(),
	name: z.string().nullish(),
	number: z.string().nullish(),
	uuid: z.string().nullish(),
});

export const reactionSchema = z.looseObject({
	emoji: z.string(),
	targetSentTimestamp: z.number().int(),
	targetAuthor: z.string().nullish(),
	targetAuthorNumber: z.string().nullish(),
	targetAuthorUuid: z.string().nullish(),
	isRemove: z.boolean().nullish(),
});

/**
 * Quoted attachments are a different record upstream
 * (`JsonQuotedAttachment(contentType, filename, thumbnail)`): no `isVoiceNote`,
 * and an optional `thumbnail` that is a full attachment.
 */
export const quotedAttachmentSchema = z.looseObject({
	contentType: z.string(),
	filename: z.string().nullish(),
	thumbnail: z.lazy(() => attachmentSchema).nullish(),
});

export const quoteSchema = z.looseObject({
	id: z.number().int(),
	author: z.string().nullish(),
	authorNumber: z.string().nullish(),
	authorUuid: z.string().nullish(),
	text: z.string().nullish(),
	mentions: z.array(mentionSchema).nullish(),
	attachments: z.array(quotedAttachmentSchema).nullish(),
});

export const remoteDeleteSchema = z.looseObject({
	timestamp: z.number().int(),
});

/** Edits carry replacement content; kept opaque to avoid a recursive schema. */
export const editMessageSchema = z.looseObject({
	targetSentTimestamp: z.number().int(),
	dataMessage: z.unknown().nullish(),
});

export const groupInfoSchema = z.looseObject({
	groupId: z.string(),
	groupName: z.string().nullish(),
	type: z.string().nullish(),
});

export const dataMessageSchema = z.looseObject({
	timestamp: z.number().int(),
	message: z.string().nullish(),
	expiresInSeconds: z.number().int().nullish(),
	attachments: z.array(attachmentSchema).optional(),
	quote: quoteSchema.optional(),
	mentions: z.array(mentionSchema).optional(),
	reaction: reactionSchema.optional(),
	viewOnce: z.boolean().optional(),
	remoteDelete: remoteDeleteSchema.optional(),
	/** Modelled kinds we do not surface yet, validated as unknown on purpose. */
	sticker: z.unknown().optional(),
	groupInfo: groupInfoSchema.optional(),
});

/**
 * A message you sent, as it comes back on your other devices: `JsonSyncDataMessage`
 * unwraps the data message, so its fields sit at the same level as `destination*`.
 */
export const sentMessageSchema = dataMessageSchema.extend({
	destination: z.string().nullish(),
	destinationNumber: z.string().nullish(),
	destinationUuid: z.string().nullish(),
	editMessage: z.unknown().nullish(),
});

export const syncMessageSchema = z.looseObject({
	sentMessage: sentMessageSchema.optional(),
	/** Replies, reactions and read receipts on other devices: not surfaced yet. */
	readMessages: z.unknown().optional(),
	blockedNumbers: z.unknown().optional(),
	blockedGroupIds: z.unknown().optional(),
	type: z.unknown().optional(),
});

export const receiptMessageSchema = z.looseObject({
	when: z.number().int(),
	isDelivery: z.boolean(),
	isRead: z.boolean(),
	isViewed: z.boolean(),
	// `List<Long>` upstream: null when the receipt names no message, which happens
	// for a receipt this build cannot use — `.optional()` alone would fail the
	// envelope instead of ignoring it.
	timestamps: z.array(z.number().int()).nullish(),
});

export const typingMessageSchema = z.looseObject({
	/** "STARTED" | "STOPPED" today — treated as an open string. */
	action: z.string(),
	timestamp: z.number().int(),
	groupId: z.string().nullish(),
});

/** Call payloads are opaque signalling blobs at this layer (SDP / ICE). */
export const callMessageSchema = z.looseObject({
	offerMessage: z.unknown().optional(),
	answerMessage: z.unknown().optional(),
	iceUpdateMessages: z.array(z.unknown()).optional(),
	hangupMessage: z.unknown().optional(),
	busyMessage: z.unknown().optional(),
});

export const envelopeSchema = z.looseObject({
	source: z.string().nullish(),
	sourceNumber: z.string().nullish(),
	sourceUuid: z.string().nullish(),
	sourceName: z.string().nullish(),
	sourceDevice: z.number().int().nullish(),
	timestamp: z.number().int(),
	serverReceivedTimestamp: z.number().int().nullish(),
	serverDeliveredTimestamp: z.number().int().nullish(),
	dataMessage: dataMessageSchema.optional(),
	/** Edits arrive beside the data message, not inside it. */
	editMessage: editMessageSchema.optional(),
	storyMessage: z.unknown().optional(),
	syncMessage: syncMessageSchema.optional(),
	callMessage: callMessageSchema.optional(),
	receiptMessage: receiptMessageSchema.optional(),
	typingMessage: typingMessageSchema.optional(),
});

export const receiveEnvelopeSchema = z.looseObject({
	envelope: envelopeSchema,
	account: z.string().optional(),
});

export type Attachment = z.infer<typeof attachmentSchema>;
export type QuotedAttachment = z.infer<typeof quotedAttachmentSchema>;
export type Quote = z.infer<typeof quoteSchema>;
export type Mention = z.infer<typeof mentionSchema>;
export type Reaction = z.infer<typeof reactionSchema>;
export type DataMessage = z.infer<typeof dataMessageSchema>;
export type EditMessage = z.infer<typeof editMessageSchema>;
export type SentMessage = z.infer<typeof sentMessageSchema>;
export type SyncMessage = z.infer<typeof syncMessageSchema>;
export type ReceiptMessage = z.infer<typeof receiptMessageSchema>;
export type TypingMessage = z.infer<typeof typingMessageSchema>;
export type CallMessage = z.infer<typeof callMessageSchema>;
export type Envelope = z.infer<typeof envelopeSchema>;
export type ReceiveEnvelope = z.infer<typeof receiveEnvelopeSchema>;
