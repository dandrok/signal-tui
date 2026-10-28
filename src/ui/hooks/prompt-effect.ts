import type { Session } from "../../app/session";
import type { Action, AppState } from "../../app/state";
import { selectedConversation } from "../../app/state";
import {
	type AttachContext,
	attachNotice,
	attachPlan,
	defaultAttachContext,
} from "../../app/usecases/attach";
import { deleteFor } from "../../app/usecases/delete";
import { editFor } from "../../app/usecases/edit";
import { forwardNotice, forwardPlan } from "../../app/usecases/forward";
import { emojiInputSummary, reactionFor, targetedMessage } from "../../app/usecases/react";

/**
 * What a confirmed prompt *does*: one branch per kind, each resolving its target from the state
 * the keystroke arrived in and handing the session the request its use case built.
 *
 * Its own module because a prompt is now five questions and this was the fattest part of the
 * reducer hook. Nothing here holds state: the wiring passes what it already has, and the only
 * effects are the session call and the notice that follows it.
 */
export interface PromptEffect {
	readonly session: Session;
	/** The state as it was *before* the dispatch — the reducer is about to close the prompt. */
	readonly state: AppState;
	readonly apply: (action: Action) => void;
	readonly refuse: (text: string) => void;
	readonly failed: (what: string) => (error: unknown) => void;
	/** Where an attach prompt reads its paths from. Injected so a test needs no real files. */
	readonly attachments?: AttachContext | undefined;
}

export function runPromptEffect(effect: PromptEffect): void {
	const { session, state, apply, refuse, failed } = effect;
	const prompt = state.prompt;
	const conversation = selectedConversation(state);
	if (prompt === null || conversation === undefined) {
		return;
	}
	// Resolved from the pre-dispatch state, like the reply target: the reducer is about to
	// forget which row the prompt named.
	const message = targetedMessage(
		state.messagesByConversation[conversation.id] ?? [],
		prompt.targetId,
	);

	switch (prompt.kind) {
		case "reaction": {
			const request = reactionFor(message, conversation.id, prompt.draft, prompt.pick);
			// The prompt closed either way; saying why is the difference between a refusal and a
			// reaction that vanished.
			if (request === null) {
				refuse(`not one emoji: ${emojiInputSummary(prompt.draft)}`);
			} else {
				void session
					.react(conversation.id, request.target, request.emoji, request.isRemove)
					.catch(failed("reaction"));
			}
			return;
		}
		case "edit": {
			const request = editFor(message, conversation.id, prompt.draft);
			if (request === null) {
				refuse("nothing to change");
			} else {
				void session.edit(conversation.id, request.target, request.body).catch(failed("edit"));
			}
			return;
		}
		case "delete": {
			const target = deleteFor(message, conversation.id);
			if (target === null) {
				refuse("only your own message can be deleted for everyone");
			} else {
				void session.remove(conversation.id, target).catch(failed("delete"));
			}
			return;
		}
		case "attach": {
			// A file is not a message about a row: it goes to the conversation, with no body —
			// this prompt does not read the composer's draft, so claiming to send one would be
			// a lie about what went out.
			//
			// The *picked* path wins over the typed text: the row is what the user is looking
			// at, and a filter is a fragment (`cv`) rather than a path. With nothing picked —
			// a path typed in full and outside any listing — the draft is all there is.
			const picked = prompt.paths?.[prompt.pick]?.path ?? prompt.draft;
			const plan = attachPlan(picked, effect.attachments ?? defaultAttachContext());
			if (plan.kind === "refused") {
				refuse(plan.reason);
			} else {
				void session
					.send(conversation.id, "", undefined, plan.file)
					.then(() => {
						apply({
							type: "notice",
							notice: { kind: "info", text: attachNotice(plan.file) },
						});
					})
					.catch(failed("attach"));
			}
			return;
		}
		case "forward": {
			// A forward is not a transport method: Signal has no such command, so it is a plain
			// send addressed to another conversation, and `send` writes the local echo that
			// makes the copy visible here at all.
			const plan = forwardPlan(
				message,
				conversation.id,
				prompt.chats ?? [],
				prompt.draft,
				prompt.pick,
			);
			if (plan.kind === "refused") {
				refuse(plan.reason);
			} else {
				void session
					.send(plan.to.id, plan.body)
					.then(() => {
						apply({
							type: "notice",
							notice: { kind: "info", text: forwardNotice(plan.to) },
						});
					})
					.catch(failed("forward"));
			}
		}
	}
}
