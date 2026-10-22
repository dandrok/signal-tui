import { z } from "zod";

/**
 * Payload schemas for the subset of signal-cli's JSON that this client consumes.
 *
 * Hand-authored rather than generated: a spike converting signal-cli's 43 JSON
 * schemas with `json-schema-to-zod` produced `z.any()` for every cross-file
 * `$ref` (e.g. `dataMessage.quote`, `dataMessage.attachments`), i.e. no
 * validation where it matters. Generation stays an option if we ever need
 * coverage of message types we do not model yet.
 *
 * Objects are `.loose()` on purpose: signal-cli adds fields between releases and
 * an unknown key must never fail a message.
 */

export const attachmentSchema = z.looseObject({
	id: z.string().optional(),
	contentType: z.string().optional(),
	filename: z.string().optional(),
	size: z.number().int().optional(),
	width: z.number().int().optional(),
	height: z.number().int().optional(),
	caption: z.string().optional(),
	isVoiceNote: z.boolean().optional(),
	uploadTimestamp: z.number().int().optional(),
});

export const quoteSchema = z.looseObject({
	id: z.number().int().optional(),
	author: z.string().optional(),
	authorNumber: z.string().optional(),
	authorUuid: z.string().optional(),
	text: z.string().optional(),
	attachments: z.array(attachmentSchema).optional(),
});

export const mentionSchema = z.looseObject({
	start: z.number().int(),
	length: z.number().int(),
	author: z.string(),
});

export const reactionSchema = z.looseObject({
	emoji: z.string(),
	targetAuthor: z.string(),
	targetTimestamp: z.number().int(),
	isRemove: z.boolean().optional(),
});

export const remoteDeleteSchema = z.looseObject({
	timestamp: z.number().int(),
});

/** Edits carry replacement content; kept opaque to avoid a recursive schema. */
export const editMessageSchema = z.looseObject({
	targetSentTimestamp: z.number().int(),
	dataMessage: z.unknown().optional(),
});

export const dataMessageSchema = z.looseObject({
	timestamp: z.number().int(),
	message: z.string().optional(),
	attachments: z.array(attachmentSchema).optional(),
	quote: quoteSchema.optional(),
	mentions: z.array(mentionSchema).optional(),
	reaction: reactionSchema.optional(),
	expiresInSeconds: z.number().int().optional(),
	viewOnce: z.boolean().optional(),
	editMessage: editMessageSchema.optional(),
	remoteDelete: remoteDeleteSchema.optional(),
});

export const receiptMessageSchema = z.looseObject({
	when: z.number().int(),
	isDelivery: z.boolean(),
	isRead: z.boolean(),
	isViewed: z.boolean(),
	timestamps: z.array(z.number().int()).optional(),
});

export const typingMessageSchema = z.looseObject({
	timestamp: z.number().int().optional(),
	/** "STARTED" | "STOPPED" | "UNKNOWN" today — treated as an open string. */
	type: z.string(),
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
	source: z.string().optional(),
	sourceNumber: z.string().optional(),
	sourceUuid: z.string().optional(),
	sourceName: z.string().optional(),
	sourceDevice: z.number().int().optional(),
	timestamp: z.number().int(),
	dataMessage: dataMessageSchema.optional(),
	receiptMessage: receiptMessageSchema.optional(),
	typingMessage: typingMessageSchema.optional(),
	callMessage: callMessageSchema.optional(),
	/** Other envelope kinds (sync, story, …) are recognised but not modelled yet. */
	syncMessage: z.unknown().optional(),
});

export const receiveEnvelopeSchema = z.looseObject({
	envelope: envelopeSchema,
	account: z.string().optional(),
});

export type Attachment = z.infer<typeof attachmentSchema>;
export type Quote = z.infer<typeof quoteSchema>;
export type Mention = z.infer<typeof mentionSchema>;
export type Reaction = z.infer<typeof reactionSchema>;
export type DataMessage = z.infer<typeof dataMessageSchema>;
export type ReceiptMessage = z.infer<typeof receiptMessageSchema>;
export type TypingMessage = z.infer<typeof typingMessageSchema>;
export type CallMessage = z.infer<typeof callMessageSchema>;
export type Envelope = z.infer<typeof envelopeSchema>;
export type ReceiveEnvelope = z.infer<typeof receiveEnvelopeSchema>;
