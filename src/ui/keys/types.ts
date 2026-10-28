import type { Action } from "../../app/state";

/**
 * What the keyboard is made of: the shape a keystroke arrives in, and the two things it can
 * ask for. Types and one constructor, so the modules that decide what a key means can share
 * them without importing the map that orders them.
 */

/** The slice of ink's `Key` this map reads. Structural, so tests need no terminal. */
export interface KeyLike {
	readonly ctrl?: boolean | undefined;
	readonly shift?: boolean | undefined;
	readonly tab?: boolean | undefined;
	readonly escape?: boolean | undefined;
	readonly return?: boolean | undefined;
	readonly backspace?: boolean | undefined;
	readonly delete?: boolean | undefined;
	readonly upArrow?: boolean | undefined;
	readonly downArrow?: boolean | undefined;
	readonly pageUp?: boolean | undefined;
	readonly pageDown?: boolean | undefined;
}

/** What a keystroke asks for: a transition, leaving the app, or nothing at all. */
export type KeyResult =
	| { readonly kind: "action"; readonly action: Action }
	| { readonly kind: "exit" }
	| null;

/** Rows a page of `j`/`k` covers while the message pane owns the keyboard. */
export const SCROLL_STEP = 10;

/** Wraps a transition in the only shape the caller dispatches. */
export const action = (next: Action): KeyResult => ({ kind: "action", action: next });
