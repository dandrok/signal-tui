import type { Action, AppState } from "../../app/state";
import { type OpenContext, type OpenFile, openNotice, openPlan } from "../../app/usecases/open";

/**
 * `o`, once it is confirmed: the plan, and the launch.
 *
 * Its own module because it is the one prompt effect that needs no session — a launch is a
 * local process, not a message — so it is also the one that works in demo mode, where there is
 * no engine at all. The plan is rebuilt here rather than carried from the key: a row can be
 * deleted, expire or lose its file between the keystroke and the confirm, and a launch is the
 * one action that must never act on a verdict from an earlier frame.
 */

export interface OpenEffect {
	readonly state: AppState;
	/** Where an open may reach, and what it launches with. */
	readonly open: OpenContext;
	readonly apply: (action: Action) => void;
	readonly refuse: (text: string) => void;
	readonly failed: (what: string) => (error: unknown) => void;
}

/** A confirmed `o`: the plan, and the launch. */
export function openEffect(effect: OpenEffect): void {
	const prompt = effect.state.prompt;
	if (prompt === null || prompt.kind !== "open") {
		return;
	}
	const files = prompt.files ?? [];
	// The list was frozen when the key was pressed, and the highlight is part of what it froze:
	// `⏎` opens the row the picker is showing, clamped exactly as the line draws it.
	const chosen = files[Math.min(Math.max(0, prompt.pick), Math.max(0, files.length - 1))];
	if (chosen === undefined) {
		effect.refuse("no file to open on that message");
		return;
	}
	const plan = openPlan(chosen, effect.open);
	if (plan.kind === "refused") {
		effect.refuse(plan.reason);
		return;
	}
	launchOpen(plan.file, effect.open, effect.apply, effect.failed);
}

/**
 * Hands a planned file to the desktop, and says so once it has started.
 *
 * Shared by the confirm prompt and by every later `o` in the run, because the two paths differ
 * only in whether a question was asked first. The notice follows the promise, not the call: a
 * launcher that fails — no `xdg-open` on a bare box, a binary that vanished — is reported
 * instead of announced, and consent is granted only for a launch that actually happened, so a
 * machine that cannot open files keeps saying so rather than remembering a yes.
 */
export function launchOpen(
	file: OpenFile,
	open: OpenContext,
	apply: (action: Action) => void,
	failed: (what: string) => (error: unknown) => void,
): void {
	void open.launch(file.path).then(() => {
		apply({ type: "notice", notice: { kind: "info", text: openNotice(file) } });
		apply({ type: "files-may-open" });
	}, failed("open"));
}
