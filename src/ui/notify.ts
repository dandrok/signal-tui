import type { IncomingNotice } from "../app/session";
import { displayLine } from "../domain/display";
import { describeAuthor, describeBody } from "../domain/format";

/**
 * Terminal notifications: a bell, a desktop toast, and the unread count in the title.
 *
 * Everything here is a string builder plus one writer, so the sequences can be asserted
 * byte for byte and the app can hand in stdout while a test hands in an array.
 *
 * `OSC 9` is the form kitty, Ghostty, WezTerm, iTerm2 and Windows Terminal show as a
 * desktop notification; a terminal without it ignores the sequence, which is why the bell
 * goes with it rather than instead of it. `OSC 0` sets the window title.
 */

/** Where sequences go: `process.stdout.write` in the app, a collector in tests. */
export type Writer = (chunk: string) => void;

const BEL = "\u0007";
const OSC = "\u001b]";

/** Longest message text a notification carries; a toast is not a reading surface. */
const MAX_BODY = 120;

/**
 * Remote text, made safe for a sequence that ends at BEL.
 *
 * The body is a peer's words. `displayLine` removes control characters and line breaks
 * already, and this adds the two things a notification's own syntax cares about: a `;`
 * (which separates the fields of the sequence) and a leading `-`, which some `notify-send`
 * style front ends would read as a flag. The length cap keeps a paste from becoming the
 * whole screen.
 */
export function notificationText(text: string, max = MAX_BODY): string {
	const line = displayLine(text).replaceAll(";", ",");
	return line.length <= max ? line : `${line.slice(0, Math.max(0, max - 1))}…`;
}

/** One line describing an arriving message: who wrote it, in which thread, and what. */
export function notificationLine(notice: IncomingNotice): string {
	const author = notificationText(describeAuthor(notice.message));
	const thread = notificationText(notice.conversationName);
	const label = thread.length === 0 || thread === author ? author : `${thread} · ${author}`;
	const body = notificationText(describeBody(notice.message));
	return body.length === 0 ? label : `${label}: ${body}`;
}

/** The bell. Kept separate: it is the fallback every terminal understands. */
export const bell = (): string => BEL;

/** `OSC 9 ; <text> BEL` — a desktop notification in the terminals that support it. */
export const toast = (text: string): string => `${OSC}9;${text}${BEL}`;

/** `OSC 2 ; <text> BEL` — the window title. */
export const title = (text: string): string => `${OSC}2;${text}${BEL}`;

/** Title text for the whole app, with the total the sidebar is showing. */
export function unreadTitle(unread: number): string {
	return unread <= 0 ? "signal-tui" : `signal-tui · ${unread} unread`;
}

/** What to write when a message arrives in a conversation nobody is looking at. */
export function incomingSequence(notice: IncomingNotice): string {
	return `${bell()}${toast(notificationLine(notice))}`;
}
