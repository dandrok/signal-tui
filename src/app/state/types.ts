import type { Conversation, ConversationId, Message, MessageId } from "../../domain/types";

/**
 * The shape of app state, and the vocabulary its transitions speak.
 *
 * Split from `state.ts` when the reducer passed the file cap. Types only, so the module
 * graph stays one-directional at runtime: nothing here can call into the reducer.
 */

export type Focus = "conversations" | "messages" | "composer";

/** Notices are typed so a transient send confirmation is never confused with an error. */
export type NoticeKind = "queued" | "info";

export interface Notice {
	readonly kind: NoticeKind;
	readonly text: string;
}

/** Search is a mode, not a pane: while it is open the keyboard belongs to it. */
export interface SearchState {
	readonly query: string;
	readonly results: readonly Message[];
	readonly selectedIndex: number;
	/** True once a query has been run, so "no results" is distinguishable. */
	readonly ran: boolean;
}

/**
 * What a prompt is for. One mode, three questions, because they share everything that
 * matters: a target row, a draft, enter to confirm, escape to leave.
 */
export type PromptKind = "reaction" | "edit" | "delete";

/**
 * An open prompt: which message it names, and what has been typed into it.
 *
 * A mode like search — while it is open the keyboard belongs to it — but it holds an id
 * rather than a message: the row can be edited, deleted or swept while the prompt is open,
 * and the send path resolves it again before anything goes on the wire.
 */
export interface PromptState {
	readonly kind: PromptKind;
	readonly targetId: MessageId;
	/** The emoji, the replacement body, or (for a delete) nothing at all. */
	readonly draft: string;
	/**
	 * Which suggestion the arrow keys are on. Only the reaction prompt has suggestions; a
	 * draft that is already one emoji ignores this, and typing resets it to the best match.
	 */
	readonly pick: number;
}

export interface AppState {
	readonly conversations: readonly Conversation[];
	readonly messagesByConversation: Readonly<Record<ConversationId, readonly Message[]>>;
	/**
	 * Which conversation is selected, by id rather than by its row in the list.
	 *
	 * The list is ordered by activity, so it reorders whenever a message arrives or is
	 * sent: an index would then point at whoever moved into that row, and the message
	 * pane would silently switch to a different person. The selection is about a
	 * conversation, so it has to survive the list moving.
	 */
	readonly selectedId: ConversationId | null;
	readonly focus: Focus;
	/** Messages hidden above the window; `0` is pinned to the newest. */
	readonly scroll: number;
	readonly draft: string;
	/**
	 * The message the draft answers, if any. An id rather than the message: the row it
	 * names can be edited or deleted while the reply is being written, and the pane must
	 * then show what actually happened to it.
	 */
	readonly replyToId: MessageId | null;
	/**
	 * True while the pane is waiting for the page above the oldest message it has. Set by
	 * the key that walks back, cleared by the load — one request at a time, so holding the
	 * key cannot queue a read per repeat.
	 */
	readonly olderRequested: boolean;
	/**
	 * Conversations whose history has been walked to the beginning. Absent means "there may
	 * be more": the pane cannot know until a page comes back short.
	 */
	readonly historyComplete: Readonly<Record<ConversationId, true>>;
	readonly notice: Notice | null;
	readonly search: SearchState | null;
	readonly prompt: PromptState | null;
}

export type Action =
	| { readonly type: "conversations-loaded"; readonly conversations: readonly Conversation[] }
	| {
			readonly type: "messages-loaded";
			readonly conversationId: ConversationId;
			readonly messages: readonly Message[];
	  }
	| { readonly type: "move-selection"; readonly delta: number }
	| { readonly type: "focus"; readonly focus: Focus }
	| { readonly type: "focus-next" }
	| { readonly type: "focus-prev" }
	| { readonly type: "scroll-moved"; readonly delta: number }
	| { readonly type: "draft-changed"; readonly value: string }
	| { readonly type: "draft-submitted" }
	/** Asks for the page above the oldest loaded message. */
	| { readonly type: "older-requested" }
	/** The read failed: the pane must be able to ask again after a transient error. */
	| { readonly type: "older-failed" }
	/** A message older than the loaded history arrived: the thread may have more behind it. */
	| { readonly type: "history-invalidated"; readonly conversationId: ConversationId }
	| {
			readonly type: "older-loaded";
			readonly conversationId: ConversationId;
			readonly messages: readonly Message[];
			/** False when the store returned a short page: that was the beginning. */
			readonly hasMore: boolean;
	  }
	/** Answers the message the pane is pointing at; the reducer resolves which one. */
	| { readonly type: "reply-started" }
	| { readonly type: "reply-cancelled" }
	/** Opens a prompt on the message the pane points at, if that message can take one. */
	| { readonly type: "prompt-opened"; readonly kind: PromptKind }
	| { readonly type: "prompt-cancelled" }
	| { readonly type: "prompt-changed"; readonly value: string }
	/** Moves the highlight through what is suggested for the current draft. */
	| { readonly type: "prompt-moved"; readonly delta: number }
	/** The prompt was confirmed: whatever can be sent, is sent by the wiring. */
	| { readonly type: "prompt-submitted" }
	/** Hides the message the pane points at, in this cache only. Resolved by the wiring. */
	| { readonly type: "hide-requested" }
	| { readonly type: "notice"; readonly notice: Notice | null }
	| { readonly type: "search-opened" }
	| { readonly type: "search-closed" }
	| { readonly type: "search-changed"; readonly query: string }
	| { readonly type: "search-results"; readonly results: readonly Message[] }
	| { readonly type: "search-moved"; readonly delta: number }
	| { readonly type: "search-selected" };
