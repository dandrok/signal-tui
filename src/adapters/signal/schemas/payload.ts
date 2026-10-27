import { z } from "zod";

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
	/**
	 * A timer change travels as a data message with no content of its own: the number is
	 * the whole payload, and it is how the conversation learns the timer it now has.
	 */
	isExpirationUpdate: z.boolean().optional(),
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
