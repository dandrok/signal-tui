import { useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "../../app/session";
import type { Action, AppState } from "../../app/state";
import {
	emptyState,
	pointedMessage,
	reduce,
	replyTarget,
	selectedConversation,
} from "../../app/state";
import { deleteFor } from "../../app/usecases/delete";
import { editFor } from "../../app/usecases/edit";
import { forwardNotice, forwardPlan } from "../../app/usecases/forward";
import { emojiInputSummary, reactionFor, targetedMessage } from "../../app/usecases/react";

/**
 * The reducer plus the side effects it cannot perform itself: a submitted draft is sent
 * through the session, and a confirmed reaction is sent the same way.
 *
 * Both resolve their target from state **before** the dispatch clears it — afterwards the
 * reducer has forgotten which row the prompt named, and a send built from the new state
 * would go out plain, which reads as the feature silently not working.
 *
 * `version` is a counter, not a value: it ticks whenever the session says the cache changed,
 * and the hooks that read the store take it as a dependency to reload.
 */
export interface RootState {
	readonly state: AppState;
	readonly dispatch: (action: Action) => void;
	readonly version: number;
}

const describe = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

export function useRootState(session: Session | undefined): RootState {
	const [state, setState] = useState<AppState>(emptyState);
	const [version, setVersion] = useState(0);
	const stateRef = useRef(state);

	/**
	 * Reduce now, and keep the ref exact.
	 *
	 * `setState` does not update `stateRef` until the next render, so two keystrokes in one
	 * tick both read the *previous* state — which is how an emoji typed and confirmed quickly
	 * reached the send path as an empty draft ("not one emoji: nothing sent", with the emoji
	 * plainly visible in the prompt). Reducing here and storing the result makes the ref
	 * exact at the moment of the dispatch, for whatever the next keystroke reads.
	 */
	const apply = useCallback((action: Action): void => {
		const next = reduce(stateRef.current, action);
		stateRef.current = next;
		setState(next);
	}, []);

	const dispatch = useCallback(
		(action: Action): void => {
			const current = stateRef.current;
			const conversation = selectedConversation(current);
			const refused = (text: string): void => {
				apply({ type: "notice", notice: { kind: "info", text } });
			};
			const failed =
				(what: string) =>
				(error: unknown): void =>
					refused(`${what} failed: ${describe(error)}`);

			if (action.type === "draft-submitted" && session !== undefined) {
				const body = current.draft.trim();
				// Resolved before the reducer clears it: the target is what makes this a reply
				// rather than a message, and only the state knows which row it names.
				const replyTo = replyTarget(current);
				if (body.length > 0 && conversation !== undefined) {
					void session.send(conversation.id, body, replyTo ?? undefined).catch((error: unknown) => {
						setState((inner) =>
							reduce(inner, {
								type: "notice",
								notice: { kind: "info", text: `send failed: ${describe(error)}` },
							}),
						);
					});
				}
			}

			if (action.type === "prompt-submitted" && session !== undefined) {
				const prompt = current.prompt;
				if (prompt !== null && conversation !== undefined) {
					// Resolved from the pre-dispatch state, like the reply target: the reducer is
					// about to forget which row the prompt named.
					const message = targetedMessage(
						current.messagesByConversation[conversation.id] ?? [],
						prompt.targetId,
					);

					if (prompt.kind === "reaction") {
						const request = reactionFor(message, conversation.id, prompt.draft, prompt.pick);
						// The prompt closed either way; saying why is the difference between a
						// refusal and a reaction that vanished.
						if (request === null) {
							refused(`not one emoji: ${emojiInputSummary(prompt.draft)}`);
						} else {
							void session
								.react(conversation.id, request.target, request.emoji, request.isRemove)
								.catch(failed("reaction"));
						}
					}

					if (prompt.kind === "edit") {
						const request = editFor(message, conversation.id, prompt.draft);
						if (request === null) {
							refused("nothing to change");
						} else {
							void session
								.edit(conversation.id, request.target, request.body)
								.catch(failed("edit"));
						}
					}

					if (prompt.kind === "delete") {
						const target = deleteFor(message, conversation.id);
						if (target === null) {
							refused("only your own message can be deleted for everyone");
						} else {
							void session.remove(conversation.id, target).catch(failed("delete"));
						}
					}

					if (prompt.kind === "forward") {
						// A forward is not a transport method: Signal has no such command, so it
						// is a plain send addressed to another conversation, and `send` writes
						// the local echo that makes the copy visible here at all.
						const plan = forwardPlan(
							message,
							conversation.id,
							prompt.candidates ?? [],
							prompt.draft,
							prompt.pick,
						);
						if (plan.kind === "refused") {
							refused(plan.reason);
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

			if (action.type === "hide-requested" && session !== undefined) {
				// Local, immediate, and reversible only by another copy of the thread: there is
				// nothing to confirm, so `D` writes at once.
				const target = pointedMessage(current);
				if (target !== undefined) {
					void session.hide(target.conversationId, target.id).catch(failed("hide"));
				}
			}

			apply(action);
		},
		[apply, session],
	);

	useEffect(() => {
		if (session === undefined) {
			return;
		}
		return session.onChange(() => setVersion((current) => current + 1));
	}, [session]);

	return { state, dispatch, version };
}
