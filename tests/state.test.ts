import { describe, expect, test } from "bun:test";
import { demoConversations, demoMessages } from "../src/adapters/memory/demo-data";
import type { AppState } from "../src/app/state";
import {
	emptyState,
	FOCUS_ORDER,
	reduce,
	selectedConversation,
	selectedIndex,
	selectedMessages,
} from "../src/app/state";

const loaded = () =>
	reduce(emptyState, { type: "conversations-loaded", conversations: demoConversations });

describe("reduce", () => {
	test("loading conversations selects the first one", () => {
		const state = loaded();
		expect(state.conversations).toHaveLength(4);
		expect(state.selectedId).toBe(demoConversations[0]?.id ?? null);
		expect(selectedIndex(state)).toBe(0);
		expect(selectedConversation(state)?.id).toBe("c-signal-devs");
	});

	test("move-selection clamps instead of wrapping", () => {
		let state = loaded();
		state = reduce(state, { type: "move-selection", delta: -1 });
		expect(selectedIndex(state)).toBe(0);

		state = reduce(state, { type: "move-selection", delta: 99 });
		expect(selectedIndex(state)).toBe(demoConversations.length - 1);
	});

	test("moving past the end is a no-op identity", () => {
		const state = reduce(loaded(), { type: "move-selection", delta: 99 });
		expect(reduce(state, { type: "move-selection", delta: 1 })).toBe(state);
	});

	test("messages are stored per conversation", () => {
		const messages = demoMessages.filter((message) => message.conversationId === "c-alice");
		const state = reduce(loaded(), {
			type: "messages-loaded",
			conversationId: "c-alice",
			messages,
		});
		expect(selectedMessages(state)).toHaveLength(0);
		const onAlice = reduce(state, { type: "move-selection", delta: 1 });
		expect(selectedMessages(onAlice).map((message) => message.id)).toEqual(["m-4", "m-5"]);
	});

	test("submitting a draft clears it and sets a queued notice", () => {
		let state = reduce(loaded(), { type: "focus", focus: "composer" });
		state = reduce(state, { type: "draft-changed", value: "  hello  " });
		state = reduce(state, { type: "draft-submitted" });
		expect(state.draft).toBe("");
		expect(state.notice).toEqual({ kind: "queued", text: "queued: hello" });
	});

	test("submitting an empty draft changes nothing", () => {
		const state = reduce(loaded(), { type: "draft-changed", value: "   " });
		expect(reduce(state, { type: "draft-submitted" })).toBe(state);
	});

	test("typing after a send clears the queued notice", () => {
		let state = reduce(loaded(), { type: "focus", focus: "composer" });
		state = reduce(state, { type: "draft-changed", value: "hi" });
		state = reduce(state, { type: "draft-submitted" });
		expect(state.notice?.kind).toBe("queued");

		state = reduce(state, { type: "draft-changed", value: "h" });
		expect(state.notice).toBeNull();
	});

	test("typing keeps an unrelated notice", () => {
		let state = reduce(loaded(), {
			type: "notice",
			notice: { kind: "info", text: "reconnecting" },
		});
		state = reduce(state, { type: "draft-changed", value: "hi" });
		expect(state.notice).toEqual({ kind: "info", text: "reconnecting" });
	});

	test("setting the same focus returns the same object", () => {
		const state = loaded();
		expect(reduce(state, { type: "focus", focus: "conversations" })).toBe(state);
	});
});

describe("pane focus", () => {
	test("tab cycles every pane and wraps", () => {
		let state = loaded();
		const seen: string[] = [state.focus];
		for (let step = 0; step < FOCUS_ORDER.length; step += 1) {
			state = reduce(state, { type: "focus-next" });
			seen.push(state.focus);
		}
		expect(seen).toEqual(["conversations", "messages", "composer", "conversations"]);
	});

	test("shift-tab walks the same list backwards", () => {
		let state = loaded();
		state = reduce(state, { type: "focus-prev" });
		expect(state.focus).toBe("composer");
		state = reduce(state, { type: "focus-prev" });
		expect(state.focus).toBe("messages");
	});

	test("a focus that is already current is an identity", () => {
		const state = reduce(loaded(), { type: "focus", focus: "messages" });
		expect(reduce(state, { type: "focus-next" })).not.toBe(state);
		expect(reduce(reduce(state, { type: "focus-next" }), { type: "focus-prev" })).toEqual(state);
	});
});

describe("scroll", () => {
	/** The selected conversation, loaded with `count` messages. */
	const withThread = (count: number): AppState => {
		const messages = Array.from({ length: count }, (_unused, index) => ({
			id: `m-${index}`,
			conversationId: "c-signal-devs",
			author: "Marta",
			body: `body-${index}`,
			sentAt: index,
			isOutgoing: false,
			isDeleted: false,
		}));
		return reduce(loaded(), {
			type: "messages-loaded",
			conversationId: "c-signal-devs",
			messages,
		});
	};

	test("scrolling up counts hidden messages and never goes negative", () => {
		let state = reduce(withThread(10), { type: "scroll-moved", delta: 3 });
		expect(state.scroll).toBe(3);
		state = reduce(state, { type: "scroll-moved", delta: -10 });
		expect(state.scroll).toBe(0);
		expect(reduce(state, { type: "scroll-moved", delta: -1 })).toBe(state);
	});

	test("stops at the oldest message so a held key cannot run away", () => {
		// Without the upper bound a held `k` counts past the start, and every press
		// back then lands in that dead range instead of moving the pane.
		const state = reduce(withThread(3), { type: "scroll-moved", delta: 99 });
		expect(state.scroll).toBe(2);
		expect(reduce(state, { type: "scroll-moved", delta: -1 }).scroll).toBe(1);
	});

	test("a thread with no messages cannot be scrolled", () => {
		expect(reduce(loaded(), { type: "scroll-moved", delta: 3 }).scroll).toBe(0);
	});

	test("changing conversation returns to the newest message", () => {
		let state = reduce(withThread(10), { type: "scroll-moved", delta: 7 });
		state = reduce(state, { type: "move-selection", delta: 1 });
		expect(state.scroll).toBe(0);
	});

	test("a reload that keeps the list in order keeps the offset", () => {
		const scrolled = reduce(withThread(10), { type: "scroll-moved", delta: 5 });
		const reloaded = reduce(scrolled, {
			type: "conversations-loaded",
			conversations: [...demoConversations],
		});
		expect(reloaded.scroll).toBe(5);
	});

	test("a reload that reorders the list keeps the same conversation and its offset", () => {
		const scrolled = reduce(withThread(10), { type: "scroll-moved", delta: 5 });
		const reordered = reduce(scrolled, {
			type: "conversations-loaded",
			conversations: [...demoConversations].reverse(),
		});
		// The conversation is the same one, only its row moved, so the offset still
		// describes where the user was in that thread.
		expect(selectedConversation(reordered)?.id).toBe("c-signal-devs");
		expect(reordered.scroll).toBe(5);
	});
});

describe("search mode", () => {
	const opened = (): AppState =>
		reduce(reduce(emptyState, { type: "conversations-loaded", conversations: demoConversations }), {
			type: "search-opened",
		});

	test("starts empty and closes back to browse", () => {
		const state = opened();
		expect(state.search).toEqual({ query: "", results: [], selectedIndex: 0, ran: false });
		expect(reduce(state, { type: "search-closed" }).search).toBeNull();
	});

	test("a new query drops the previous results", () => {
		let state = reduce(opened(), { type: "search-changed", query: "dinner" });
		state = reduce(state, { type: "search-results", results: demoMessages.slice(0, 2) });
		expect(state.search?.results).toHaveLength(2);

		state = reduce(state, { type: "search-changed", query: "dinne" });

		// Showing stale hits under a new query would imply they match it.
		expect(state.search?.results).toEqual([]);
		expect(state.search?.ran).toBe(false);
	});

	test("moves within results and clamps at the ends", () => {
		let state = reduce(opened(), { type: "search-results", results: demoMessages.slice(0, 2) });
		expect(state.search?.selectedIndex).toBe(0);

		state = reduce(state, { type: "search-moved", delta: 5 });
		expect(state.search?.selectedIndex).toBe(1);
		state = reduce(state, { type: "search-moved", delta: -5 });
		expect(state.search?.selectedIndex).toBe(0);
	});

	test("selecting a result jumps to its conversation and closes search", () => {
		const target = demoMessages.find((entry) => entry.conversationId !== demoConversations[0]?.id);
		let state = reduce(opened(), { type: "search-results", results: target ? [target] : [] });

		state = reduce(state, { type: "search-selected" });

		expect(state.search).toBeNull();
		expect(selectedConversation(state)?.id).toBe(target?.conversationId);
	});

	test("selecting with no results changes nothing", () => {
		const state = reduce(opened(), { type: "search-selected" });
		expect(state.search).not.toBeNull();
	});

	test("query and results updates are ignored when search is closed", () => {
		const closed = reduce(emptyState, { type: "search-changed", query: "x" });
		expect(closed.search).toBeNull();
		expect(
			reduce(emptyState, { type: "search-results", results: demoMessages.slice(0, 1) }).search,
		).toBeNull();
	});
});
