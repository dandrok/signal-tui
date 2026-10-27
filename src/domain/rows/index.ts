/**
 * Fitting content into a pane measured in rows.
 *
 * One concern per file, because they answer different questions: `text` measures a string,
 * `body` cuts a message's body, `attachments` budgets file lines, `quote` composes the one
 * row a reply spends on what it answers, `message` adds a message's rows up and `draft`
 * keeps the composer's cursor on screen. They have to agree — a window fitted with one
 * arithmetic and drawn with another clips a message — so every function here measures the
 * string the pane draws, and `format.ts` stays the only place those strings are composed.
 *
 * Callers outside `domain/rows/` enter through this file; the split is internal.
 */

export { attachmentsForDisplay, type DisplayAttachments } from "./attachments";
export { bodyForDisplay } from "./body";
export { type DraftTail, draftTail } from "./draft";
export { messageOverheadRows, messageRowCount } from "./message";
export { QUOTE_NOT_LOADED, type QuoteLookup, quoteBlockFor, quoteForDisplay } from "./quote";
export { type DisplayBody, textForDisplay } from "./text";
