import type { Contact, Conversation, MessageId } from "../../domain/types";
import type { AttachCandidate } from "../usecases/attach";
import type { OpenFile } from "../usecases/open";

/**
 * What a prompt is, and what it is pointing at.
 *
 * Split from `types.ts` when that file passed the cap, and along the line the subject already
 * had: everything here is about the modal question the keyboard is answering, and nothing here
 * mentions the action vocabulary the reducer speaks. `types.ts` re-exports both names, so the
 * callers did not move.
 */

/**
 * What a prompt is for. One mode, six questions, because they share everything that matters:
 * a draft, enter to confirm, escape to leave — and, for four of them, a row to point at.
 *
 * `open` is the one that asks rather than types: launching a file is the first thing this
 * client does that leaves the terminal, so the first `o` of a session asks and the rest do not
 * (see `filesMayOpen`).
 */
export type PromptKind = "reaction" | "edit" | "delete" | "forward" | "attach" | "open" | "new";

/**
 * An open prompt: which message it names, and what has been typed into it.
 *
 * A mode like search — while it is open the keyboard belongs to it — but it holds an id
 * rather than a message: the row can be edited, deleted or swept while the prompt is open,
 * and the send path resolves it again before anything goes on the wire.
 */
export interface PromptState {
	readonly kind: PromptKind;
	/**
	 * The row the prompt names, or null for the one prompt that names no row: a file is sent to
	 * the conversation, not to a message.
	 */
	readonly targetId: MessageId | null;
	/** The emoji, the replacement body, the conversation filter, a file path, or (for a delete) nothing. */
	readonly draft: string;
	/**
	 * Which suggestion the arrow keys are on. The reaction, forward and attach prompts all have
	 * a list; a draft that is already one emoji ignores this, and typing resets it to the best
	 * match.
	 */
	readonly pick: number;
	/**
	 * Where a forward can go, frozen when the prompt opened.
	 *
	 * A snapshot rather than a fresh read of the conversation list, because that list is ordered
	 * by activity and reorders whenever a message arrives: an index into a list that moved
	 * between the keystroke and the confirm would send somebody's message to whoever slid into
	 * that row. The list the user is looking at is the list they are choosing from.
	 */
	readonly chats?: readonly Conversation[];
	/**
	 * What an attach prompt matched, listed from the draft on the keystroke that changed it.
	 *
	 * Carried on the action rather than read in the reducer: the filesystem is the one source
	 * this state cannot own, and a list read a frame late would send the file the user typed
	 * *before* the one they are looking at.
	 */
	readonly paths?: readonly AttachCandidate[];
	/**
	 * What an open prompt offers, frozen when the prompt opened — one row per file the message
	 * carries, in the order the pane draws them.
	 *
	 * A snapshot for the same reason a forward freezes its chats: a row can be edited or swept
	 * while the prompt is up, and `⏎` has to open the file the picker is showing rather than
	 * whichever one a re-read would now produce.
	 */
	readonly files?: readonly OpenFile[];
	/**
	 * What a `new` prompt can offer, read from the engine when the prompt opened.
	 *
	 * Absent is "not asked yet" — the read is a round-trip, so the first frame of the prompt has
	 * no list — and an empty array is the honest answer for an account with no contacts, which the
	 * plan refuses in its own words rather than as "nothing matches".
	 */
	readonly contacts?: readonly Contact[];
}
