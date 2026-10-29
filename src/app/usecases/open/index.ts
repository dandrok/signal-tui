/**
 * Opening a received file, as one use case.
 *
 * Two files, because the two halves answer different questions. `plan.ts` answers *what would
 * `o` do on this row* — a verdict, cheap enough for the status line and exact enough for the
 * launch — and `context.ts` is where the one directory a launch may reach is decided, together
 * with the two filesystem calls and the desktop opener that are injected in its place in a test.
 *
 * Nothing outside this slice imports its internals, so a function may move between the two.
 */

export {
	defaultOpenContext,
	nodeOpenFs,
	type OpenContext,
	type OpenFs,
} from "./context";
export { nodeLaunch } from "./launch";
export {
	canOpen,
	type OpenCandidate,
	type OpenFile,
	type OpenPlan,
	openCandidate,
	openNotice,
	openPlan,
} from "./plan";
export { engineAttachmentsRoot, inAttachmentsDir } from "./root";
