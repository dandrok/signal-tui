import type { PromptState } from "../app/state";
import { forwardMatches } from "../app/usecases/forward";
import type { NewChatMatches } from "../app/usecases/new-chat";
import { displayLine } from "../domain/display";
import { displayName, formatBytes, truncate } from "../domain/format";
import type { Contact, Conversation } from "../domain/types";

/**
 * The one choice a prompt row can name, as text.
 *
 * Split from `PromptBar` when the bar passed the line budget: the component measures and colours a
 * row, and deciding *which* row that row is worth showing is a separate, pure question — one
 * branch per prompt kind, no ink in it.
 *
 * `picked` says whether it is a real entry or a message about having none, because the row draws
 * the two differently — an inverted row is a choice, a dim one is a sentence.
 */

/** Cells a name may take before it is cut: a picked row, not a list. */
const NAME_CELLS = 22;
/** Cells the detail under it may take: a full phone number fits, a long uuid is cut. */
const NUMBER_CELLS = 16;

export const NO_CHATS: readonly Conversation[] = [];
export const NO_CONTACTS: readonly Contact[] = [];

export interface PromptChoice {
	readonly destination: string;
	readonly picked: boolean;
}

export function choiceLine(prompt: PromptState, newChat: NewChatMatches | null): PromptChoice {
	if (prompt.kind === "forward") {
		const { matches, picked } = forwardMatches(prompt.chats ?? NO_CHATS, prompt.draft, prompt.pick);
		const chosen = matches[picked];
		return chosen === undefined
			? { destination: "no chat matches", picked: false }
			: {
					destination: `${truncate(displayName(chosen), NAME_CELLS)} ${picked + 1}/${matches.length}`,
					picked: true,
				};
	}
	if (prompt.kind === "open") {
		const files = prompt.files;
		if (files === undefined || files.length === 0) {
			// Nothing to offer: the prompt is only opened with a list, so this is the frame before
			// the list arrives, and saying nothing is truer than naming a file that is not there.
			return { destination: "", picked: false };
		}
		const chosen = files[Math.min(Math.max(0, prompt.pick), files.length - 1)];
		return chosen === undefined
			? { destination: "", picked: false }
			: {
					destination: `${truncate(displayLine(chosen.name), NAME_CELLS)} ${prompt.pick + 1}/${files.length}`,
					picked: true,
				};
	}
	if (prompt.kind === "new") {
		const contacts = prompt.contacts;
		// The picker asked the engine and has not been answered yet: saying nothing would look
		// like an account with no contacts, which is a different and much worse fact.
		if (contacts === undefined || newChat === null) {
			return { destination: "reading contacts…", picked: false };
		}
		const { rows, picked } = newChat;
		const chosen = rows[picked];
		return chosen === undefined
			? {
					destination: contacts.length === 0 ? "no contacts yet" : "nothing matches",
					picked: false,
				}
			: {
					// The number rides along with the name: two people can share a first name, and the
					// row this picker is choosing between is addressed by the number, not by the word.
					destination: `${truncate(chosen.name, NAME_CELLS)} ${truncate(chosen.detail, NUMBER_CELLS)} ${picked + 1}/${rows.length}`,
					picked: true,
				};
	}
	if (prompt.kind === "attach") {
		const paths = prompt.paths;
		if (paths === undefined) {
			// The listing arrives with the keystroke that opened the prompt; before that there
			// is nothing true to say about it.
			return { destination: "", picked: false };
		}
		const chosen = paths[prompt.pick];
		if (chosen === undefined) {
			return { destination: "no file matches", picked: false };
		}
		// A directory ends in a slash and has no size; a file carries the number that decides
		// whether sending it is a good idea.
		const size = chosen.isDirectory || chosen.size === null ? "" : ` ${formatBytes(chosen.size)}`;
		const name = `${truncate(chosen.name, NAME_CELLS)}${chosen.isDirectory ? "/" : ""}`;
		return { destination: `${name}${size} ${prompt.pick + 1}/${paths.length}`, picked: true };
	}
	return { destination: "", picked: false };
}
