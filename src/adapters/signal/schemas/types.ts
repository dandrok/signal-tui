import type { z } from "zod";
import type * as envelope from "./envelope";
import type * as payload from "./payload";

/**
 * The inferred types, so a mapper reads `DataMessage` rather than
 * `z.infer<typeof dataMessageSchema>` everywhere. They are the only surface most of the
 * adapter needs: `map-envelope` never touches a schema, only what one produced.
 */
export type Attachment = z.infer<typeof payload.attachmentSchema>;
export type QuotedAttachment = z.infer<typeof payload.quotedAttachmentSchema>;
export type Quote = z.infer<typeof payload.quoteSchema>;
export type Mention = z.infer<typeof payload.mentionSchema>;
export type Reaction = z.infer<typeof payload.reactionSchema>;
export type DataMessage = z.infer<typeof payload.dataMessageSchema>;
export type EditMessage = z.infer<typeof payload.editMessageSchema>;
export type SentMessage = z.infer<typeof envelope.sentMessageSchema>;
export type SyncMessage = z.infer<typeof envelope.syncMessageSchema>;
export type ReceiptMessage = z.infer<typeof envelope.receiptMessageSchema>;
export type TypingMessage = z.infer<typeof envelope.typingMessageSchema>;
export type CallMessage = z.infer<typeof envelope.callMessageSchema>;
export type Envelope = z.infer<typeof envelope.envelopeSchema>;
export type ReceiveEnvelope = z.infer<typeof envelope.receiveEnvelopeSchema>;
