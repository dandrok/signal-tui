import { describe, expect, test } from "bun:test";
import type { AppState } from "../src/app/state";
import { emptyState, reduce } from "../src/app/state";
import { type KeyLike, keyAction } from "../src/ui/keymap";

/**
 * The keymap is a pure function now, so the routing rules can be tested without a terminal
 * or a render: which branch wins, and what a key turns into.
 *
 * The rules worth pinning are the ones that were bugs before: `tab` must move panes rather
 * than be typed into a draft, search must own the keyboard while it is open, and `k` at the
 * top of the loaded history must ask for a page instead of scrolling into nothing.
 */

const state = (overrides: Partial<AppState> = {}): AppState => ({ ...emptyState, ...overrides });

const key = (overrides: KeyLike = {}): KeyLike => overrides;

const conversation = { id: "uuid-alice", name: "Alice", unreadCount: 0, lastActivityAt: 1 };
const message = (sentAt: number) => ({
	id: `uuid-alice:${sentAt}`,
	conversationId: "uuid-alice",
	author: "Alice",
	sentAt,
	isOutgoing: false,
	isDeleted: false,
	body: "hi",
	attachments: [],
});

const thread = state({
	conversations: [conversation],
	selectedId: "uuid-alice",
	focus: "messages",
	messagesByConversation: { "uuid-alice": [message(1), message(2)] },
});

describe("keymap", () => {
	test("ctrl-c leaves, whatever else is going on", () => {
		expect(keyAction({ ...thread, search: null }, "c", key({ ctrl: true }))).toEqual({
			kind: "exit",
		});
	});

	test("search owns the keyboard while it is open", () => {
		const searching: AppState = {
			...thread,
			search: { query: "hi", results: [], selectedIndex: 0, ran: true },
		};

		// `j` would move the selection in a pane; with search open it types instead.
		expect(keyAction(searching, "j", key())).toEqual({
			kind: "action",
			action: { type: "search-changed", query: "hij" },
		});
		expect(keyAction(searching, "", key({ escape: true }))).toEqual({
			kind: "action",
			action: { type: "search-closed" },
		});
	});

	test("tab moves panes before the composer can type it", () => {
		const composing = state({ focus: "composer" });

		// `input` is empty for tab, so a composer branch that ran first would type nothing
		// and swallow it; the pane change is the observable difference.
		expect(keyAction(composing, "", key({ tab: true }))).toEqual({
			kind: "action",
			action: { type: "focus-next" },
		});
		expect(keyAction(composing, "", key({ tab: true, shift: true }))).toEqual({
			kind: "action",
			action: { type: "focus-prev" },
		});
	});

	test("the composer takes the rest of the keyboard", () => {
		const composing = state({ focus: "composer", draft: "hel" });

		expect(keyAction(composing, "lo", key())).toEqual({
			kind: "action",
			action: { type: "draft-changed", value: "hello" },
		});
		expect(keyAction(composing, "", key({ return: true }))).toEqual({
			kind: "action",
			action: { type: "draft-submitted" },
		});
	});

	test("escape cancels a reply rather than the focus, when a reply is open", () => {
		const composing = state({ focus: "composer", replyToId: "uuid-alice:2" });

		expect(keyAction(composing, "", key({ escape: true }))).toEqual({
			kind: "action",
			action: { type: "reply-cancelled" },
		});
	});

	test("k at the top of what is loaded asks for the page above it", () => {
		// Two messages loaded, scrolled to the oldest: there is nothing left to scroll to.
		const atTop: AppState = { ...thread, scroll: 1 };

		expect(keyAction(atTop, "k", key())).toEqual({
			kind: "action",
			action: { type: "older-requested" },
		});
		// One step down, `k` is an ordinary scroll.
		expect(keyAction({ ...thread, scroll: 0 }, "k", key())).toEqual({
			kind: "action",
			action: { type: "scroll-moved", delta: 1 },
		});
	});

	test("r starts a reply only while the message pane has the keyboard", () => {
		expect(keyAction(thread, "r", key())).toEqual({
			kind: "action",
			action: { type: "reply-started" },
		});
		expect(keyAction({ ...thread, focus: "conversations" }, "r", key())).toBeNull();
	});

	test("x, e and d open their prompts, and only where a message is pointed at", () => {
		expect(keyAction(thread, "x", key())).toEqual({
			kind: "action",
			action: { type: "prompt-opened", kind: "reaction" },
		});
		expect(keyAction(thread, "e", key())).toEqual({
			kind: "action",
			action: { type: "prompt-opened", kind: "edit" },
		});
		expect(keyAction(thread, "d", key())).toEqual({
			kind: "action",
			action: { type: "prompt-opened", kind: "delete" },
		});
		expect(keyAction(thread, "D", key())).toEqual({
			kind: "action",
			action: { type: "hide-requested" },
		});
		for (const input of ["x", "e", "d", "D"]) {
			expect(keyAction({ ...thread, focus: "conversations" }, input, key())).toBeNull();
		}
	});

	test("an open prompt owns the keyboard", () => {
		// Modal, like search: `j` must type into the prompt rather than move the selection,
		// and escape has to leave the prompt before it does anything else.
		const prompting: AppState = {
			...thread,
			prompt: { kind: "reaction", targetId: "uuid-alice:2", draft: "👍", pick: 0 },
		};

		expect(keyAction(prompting, "j", key())).toEqual({
			kind: "action",
			action: { type: "prompt-changed", value: "👍j" },
		});
		expect(keyAction(prompting, "", key({ return: true }))).toEqual({
			kind: "action",
			action: { type: "prompt-submitted" },
		});
		expect(keyAction(prompting, "", key({ escape: true }))).toEqual({
			kind: "action",
			action: { type: "prompt-cancelled" },
		});
	});

	test("a delete is confirmed, never typed into", () => {
		// The one prompt whose keystroke removes a message from other people's phones: `y` or
		// enter confirms, `n` and escape leave, and anything else is ignored rather than
		// accumulating characters nobody asked for.
		const confirming: AppState = {
			...thread,
			prompt: { kind: "delete", targetId: "uuid-alice:2", draft: "", pick: 0 },
		};

		expect(keyAction(confirming, "y", key())).toEqual({
			kind: "action",
			action: { type: "prompt-submitted" },
		});
		expect(keyAction(confirming, "", key({ return: true }))).toEqual({
			kind: "action",
			action: { type: "prompt-submitted" },
		});
		expect(keyAction(confirming, "n", key())).toEqual({
			kind: "action",
			action: { type: "prompt-cancelled" },
		});
		expect(keyAction(confirming, "z", key())).toBeNull();
	});

	test("an edit prompt starts from the body it replaces, and types over it", () => {
		const editing: AppState = {
			...thread,
			prompt: { kind: "edit", targetId: "uuid-alice:2", draft: "hell", pick: 0 },
		};

		expect(keyAction(editing, "o", key())).toEqual({
			kind: "action",
			action: { type: "prompt-changed", value: "hello" },
		});
		expect(keyAction(editing, "", key({ backspace: true }))).toEqual({
			kind: "action",
			action: { type: "prompt-changed", value: "hel" },
		});
	});

	test("an unbound key does nothing", () => {
		expect(keyAction(thread, "z", key())).toBeNull();
	});

	test("j in the conversation list selects the next thread", () => {
		// The end of the path a keystroke actually takes: key → action → reducer → a state
		// whose selection moved. A key that dispatched a type no branch handles would fail
		// here, which is the failure mode a pure map invites.
		const twoThreads = state({
			conversations: [conversation, { ...conversation, id: "uuid-bob", name: "Bob" }],
			selectedId: "uuid-alice",
			focus: "conversations",
		});
		const produced = keyAction(twoThreads, "j", key());

		expect(produced).not.toBeNull();
		if (produced?.kind !== "action") {
			throw new Error("expected an action");
		}
		expect(reduce(twoThreads, produced.action).selectedId).toBe("uuid-bob");
	});
});
