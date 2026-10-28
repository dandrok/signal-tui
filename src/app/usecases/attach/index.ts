/**
 * Attaching a file, as one use case.
 *
 * Two files, because the two halves run at different rates: `listing.ts` answers *what can I
 * pick* on every keystroke, and `plan.ts` answers *what happens if I pick this* once, on `⏎`.
 * This barrel is the surface — everything outside the slice imports from here, so moving a
 * function between the two is not a change anywhere else.
 */

export {
	type AttachCandidate,
	type AttachContext,
	type AttachFs,
	type AttachListing,
	attachListing,
	defaultAttachContext,
	draftSplit,
	MAX_SUGGESTIONS,
	nodeAttachFs,
} from "./listing";
export {
	type AttachPlan,
	attachNotice,
	attachPlan,
	MAX_ATTACHMENT_BYTES,
} from "./plan";
