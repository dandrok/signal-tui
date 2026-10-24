/**
 * Text from a peer is drawn into a terminal, and a terminal interprets what it
 * is given. Ink strips OSC sequences (clipboard, window title) but passes SGR
 * through, so a message body can recolour the rest of the pane, hide its own
 * text, or reverse it with a bidi override. Nothing remote reaches a `<Text>`
 * node without passing through here first.
 *
 * The store keeps the raw text: sanitising happens at the display boundary, so
 * search still matches what the sender actually wrote.
 */

/** CSI, OSC, DCS and the two-character escapes: everything that starts with ESC. */
const ESCAPE_SEQUENCE =
	// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point
	/\u001B(?:\[[0-9;?]*[ -/]*[@-~]|\][^\u0007\u001B]*(?:\u0007|\u001B\\)?|[()#%][0-9A-Za-z]|[@-Z\\-_])/g;

/** C0 and C1 controls except tab, newline and carriage return, handled separately. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

/** Bidi overrides and isolates, and the marks that steer them. */
const BIDI_CONTROLS = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

/** Zero-width characters that make two different strings render identically. */
const ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF]/g;

const TABS_AND_BREAKS = /[\t\r\n\v\f]+/g;

/**
 * Multi-line text with every terminal directive removed: for message bodies,
 * which may legitimately span lines. Tabs become spaces so the pane's own
 * row arithmetic stays true.
 */
export function displayText(raw: string): string {
	return raw
		.replace(ESCAPE_SEQUENCE, "")
		.replace(CONTROL_CHARS, "")
		.replace(BIDI_CONTROLS, "")
		.replace(ZERO_WIDTH, "")
		.replace(/\t/g, " ")
		.replace(/\r\n?/g, "\n");
}

/**
 * Single-line text: names, authors, filenames and notices. Any break becomes a
 * space, so a peer cannot inject extra rows into a label that is measured as one.
 */
export function displayLine(raw: string): string {
	return displayText(raw).replace(TABS_AND_BREAKS, " ").trim();
}
