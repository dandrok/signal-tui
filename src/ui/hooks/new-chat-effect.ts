import type { Session } from "../../app/session";
import type { Action, PromptState } from "../../app/state";
import { newChatPlan, openedNotice } from "../../app/usecases/new-chat";

/**
 * The `new` prompt's two side effects, kept out of `useRootState` the way `open-effect.ts` is.
 *
 * Opening the prompt is a read — who does the account know — and confirming it is a write, but
 * neither touches the engine: a conversation that nobody has written in is a local row, and the
 * first message is what makes it real. What both need is the session (or the news that there is
 * none), which is exactly what the reducer cannot have.
 */

type Apply = (action: Action) => void;
/** Says something out loud in the status line: a refusal, or what just happened. */
type Say = (text: string) => void;

/**
 * Opens the picker and asks who it knows.
 *
 * The list arrives a frame or two later, so the prompt is up first and draws "reading contacts…":
 * an empty picker would say the account has no contacts, which is a different fact and usually a
 * false one. A read that fails is still an answer — an empty list plus the reason, so the picker
 * stays usable for a typed number, which needs no contacts at all.
 */
export function newChatOpened(
	apply: Apply,
	session: Session | undefined,
	action: Extract<Action, { type: "prompt-opened" }>,
	say: Say,
): void {
	apply(action);
	if (session === undefined) {
		// No engine is not a failure here: a typed number still works, and a demo Root with no
		// session is how the frame tests render this pane.
		apply({ type: "prompt-contacts", contacts: [] });
		return;
	}
	void session
		.listContacts()
		.then((contacts) => apply({ type: "prompt-contacts", contacts }))
		.catch((error: unknown) => {
			apply({ type: "prompt-contacts", contacts: [] });
			say(`contacts unavailable: ${error instanceof Error ? error.message : String(error)}`);
		});
}

/**
 * Confirms the picker: open that thread, or say why there is nothing to open.
 *
 * The prompt closes before the write lands, because the row it names is already decided — and the
 * selection is set by id afterwards, since the list reload that follows a write would otherwise
 * keep whoever was selected a moment ago.
 */
export function newChatSubmitted(
	apply: Apply,
	session: Session | undefined,
	prompt: PromptState,
	close: Action,
	say: Say,
	failed: (what: string) => (error: unknown) => void,
): void {
	const plan = newChatPlan(prompt.contacts ?? [], prompt.draft, prompt.pick);
	apply(close);
	if (plan.kind === "refused") {
		say(plan.reason);
		return;
	}
	if (session === undefined) {
		say("no engine: cannot start a conversation");
		return;
	}
	void session
		.startDirect(plan.id, plan.name)
		.then(() => {
			apply({ type: "conversation-selected", id: plan.id });
			apply({ type: "notice", notice: { kind: "info", text: openedNotice(plan.name) } });
		})
		.catch(failed("start conversation"));
}
