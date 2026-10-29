/**
 * Opening a received file, as one use case.
 *
 * Three files, because the three questions run at different rates. `candidates.ts` answers *what
 * does this row offer* from text alone — cheap enough for the status line on every keystroke.
 * `plan.ts` answers *what does the list become once the disk agrees*, and *may this one launch*,
 * both re-checked at the moment they matter. `context.ts` is where the one directory a launch may
 * reach is decided, with the two filesystem calls and the opener that a test replaces.
 *
 * Nothing outside this slice imports its internals, so a function may move between the files.
 */

export { canOpen, type OpenFile, openCandidates, rowRefusal } from "./candidates";
export {
	defaultOpenContext,
	nodeOpenFs,
	type OpenContext,
	type OpenFs,
} from "./context";
export { nodeLaunch } from "./launch";
export {
	type OpenList,
	type OpenPlan,
	openFiles,
	openNotice,
	openPlan,
} from "./plan";
export { engineAttachmentsRoot, inAttachmentsDir } from "./root";
