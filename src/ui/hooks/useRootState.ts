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
import { type AttachContext, attachListing, defaultAttachContext } from "../../app/usecases/attach";
import { defaultOpenContext, type OpenContext, openFiles, openPlan } from "../../app/usecases/open";
import { newChatOpened, newChatSubmitted } from "./new-chat-effect";
import { launchOpen, openEffect } from "./open-effect";
import { runPromptEffect } from "./prompt-effect";

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

export function useRootState(
	session: Session | undefined,
	attachments: AttachContext = defaultAttachContext(),
	open: OpenContext = defaultOpenContext(),
): RootState {
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

			// The filesystem answers for an attach prompt, and it has to answer *inside* the
			// keystroke: a listing read a frame later would send the file the user typed before
			// the one they are looking at.
			// Starting a conversation asks the engine who it knows, then writes a local row — no
			// send, no round-trip beyond the contacts. Both halves live in `new-chat-effect.ts`.
			if (action.type === "prompt-opened" && action.kind === "new") {
				newChatOpened(apply, session, action, refused);
				return;
			}
			if (action.type === "prompt-opened" && action.kind === "attach") {
				apply({ ...action, paths: attachListing("", 0, attachments).candidates });
				return;
			}
			if (action.type === "prompt-changed" && current.prompt?.kind === "attach") {
				apply({
					...action,
					paths: attachListing(action.value, 0, attachments).candidates,
				});
				return;
			}

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

			if (action.type === "prompt-submitted" && current.prompt?.kind === "new") {
				newChatSubmitted(apply, session, current.prompt, action, refused, failed);
				return;
			}

			if (action.type === "prompt-submitted") {
				// One branch per prompt kind lives in `prompt-effect.ts`: this hook owns the
				// transitions, and that file owns what a confirmed one does. `o` is the one kind
				// that needs no engine — a launch is a local process — so it is answered even in
				// demo mode, where a prompt that closed with nothing happening would read as a
				// dead key.
				if (session === undefined) {
					if (current.prompt?.kind === "open") {
						openEffect({ state: current, open, apply, refuse: refused, failed });
					}
				} else {
					runPromptEffect({
						session,
						state: current,
						apply,
						refuse: refused,
						failed,
						attachments,
						open,
					});
				}
			}

			if (action.type === "open-requested") {
				// `o` is decided here rather than in the reducer, because the verdict needs the
				// filesystem and the reducer has none. A refusal is said out loud: nothing opened and
				// no prompt appeared, which otherwise reads as a dead key.
				const listed =
					conversation === undefined
						? ({ kind: "refused", reason: "no conversation is open" } as const)
						: openFiles(pointedMessage(current), conversation.id, open);
				if (listed.kind === "refused") {
					refused(listed.reason);
					return;
				}
				// One file and a yes already given: open it. Anything else — several files to choose
				// between, or the first launch of the run — is a question, and the picker is the
				// question: choosing a row and pressing ⏎ is the confirmation.
				if (current.filesMayOpen === true && listed.files.length === 1) {
					const [only] = listed.files;
					if (only !== undefined) {
						const plan = openPlan(only, open);
						if (plan.kind === "refused") {
							refused(plan.reason);
							return;
						}
						launchOpen(plan.file, open, apply, failed);
						return;
					}
				}
				apply({ type: "prompt-opened", kind: "open", files: listed.files });
				return;
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
		[apply, session, attachments, open],
	);

	useEffect(() => {
		if (session === undefined) {
			return;
		}
		return session.onChange(() => setVersion((current) => current + 1));
	}, [session]);

	return { state, dispatch, version };
}
