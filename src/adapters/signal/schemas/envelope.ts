import { z } from "zod";
import { dataMessageSchema, editMessageSchema } from "./payload";

/**
 * A message you sent, as it comes back on your other devices: `JsonSyncDataMessage`
 * unwraps the data message, so its fields sit at the same level as `destination*`.
 *
 * The timestamp is optional here and nowhere else: when you correct a message on
 * another device the transcript carries `editMessage` and no flattened data message,
 * so the timestamp that identifies an ordinary sent message is absent.
 */
export const sentMessageSchema = dataMessageSchema.omit({ timestamp: true }).extend({
	timestamp: z.number().int().optional(),
	destination: z.string().nullish(),
	destinationNumber: z.string().nullish(),
	destinationUuid: z.string().nullish(),
	/** An edit made on another device: the replacement content, never a message of its own. */
	editMessage: editMessageSchema.optional(),
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
