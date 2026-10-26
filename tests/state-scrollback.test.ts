import { describe, expect, test } from "bun:test";
import type { AppState } from "../src/app/state";
import { emptyState, reduce } from "../src/app/state";
import type { Conversation, Message } from "../src/domain/types";

const conversation: Conversation = {
	id: "c1",
	name: "Alice",
	unreadCount: 0,
	lastActivityAt: 0,
};

const message = (index: number): Message => ({
	id: `c1:${1_000 + index * 10}`,
	conversationId: "c1",
	author: "Alice",
	authorId: "uuid-alice",
	body: `message-${index}`,
	sentAt: 1_000 + index * 10,
	isOutgoing: false,
	isDeleted: false,
});

const loaded = (messages: readonly Message[], overrides: Partial<AppState> = {}): AppState => ({
	...emptyState,
	conversations: [conversation],
	selectedId: "c1",
	messagesByConversation: { c1: messages },
	focus: "messages",
	...overrides,
});

const newestPage = (): readonly Message[] =>
	Array.from({ length: 50 }, (_unused, index) => message(50 + index));

const olderPage = (): readonly Message[] =>
	Array.from({ length: 50 }, (_unused, index) => message(index));

describe("asking for history", () => {
	test("marks the request, so one key press is one read", () => {
		const asked = reduce(loaded(newestPage()), { type: "older-requested" });

		expect(asked.olderRequested).toBe(true);
		// A second press while the first is in flight changes nothing.
		expect(reduce(asked, { type: "older-requested" })).toBe(asked);
	});

	test("refuses when the thread has been walked to the beginning", () => {
		const complete = loaded(newestPage(), { historyComplete: { c1: true } });

		expect(reduce(complete, { type: "older-requested" })).toBe(complete);
	});

	test("a page is prepended and the offset grows with it", () => {
		// The window is measured from the newest row, so growing the list by N older messages
		// hides N more above it — that is what keeps the message being read still.
		const state = loaded(newestPage(), { olderRequested: true });
		const next = reduce(state, {
			type: "older-loaded",
			conversationId: "c1",
			messages: olderPage(),
			hasMore: true,
		});

		expect(next.messagesByConversation.c1).toHaveLength(100);
		expect(next.messagesByConversation.c1?.[0]?.body).toBe("message-0");
		expect(next.scroll).toBe(50);
		expect(next.olderRequested).toBe(false);
		expect(next.historyComplete.c1).toBeUndefined();
	});

	test("a short page is the beginning, and it stops asking", () => {
		const state = loaded(newestPage(), { olderRequested: true });
		const next = reduce(state, {
			type: "older-loaded",
			conversationId: "c1",
			messages: [message(49)],
			hasMore: false,
		});

		expect(next.historyComplete.c1).toBe(true);
		expect(reduce(next, { type: "older-requested" })).toBe(next);
	});

	test("an empty page ends the history without moving anything", () => {
		const state = loaded(newestPage(), { olderRequested: true });
		const next = reduce(state, {
			type: "older-loaded",
			conversationId: "c1",
			messages: [],
			hasMore: false,
		});

		expect(next.historyComplete.c1).toBe(true);
		expect(next.scroll).toBe(0);
		expect(next.messagesByConversation.c1).toHaveLength(50);
	});

	test("a row that arrives twice is stored once", () => {
		const state = loaded(newestPage(), { olderRequested: true });
		const overlapping = [message(49), message(50)];

		const next = reduce(state, {
			type: "older-loaded",
			conversationId: "c1",
			messages: overlapping,
			hasMore: true,
		});

		const ids = next.messagesByConversation.c1?.map((entry) => entry.id) ?? [];
		expect(new Set(ids).size).toBe(ids.length);
	});
});

describe("a page request can fail, be dropped, or be overtaken", () => {
	test("a failed read releases the request so the key works again", () => {
		// One transient error must not make `k` a no-op for the rest of the session.
		const asked = reduce(loaded(newestPage()), { type: "older-requested" });
		const failed = reduce(asked, { type: "older-failed" });

		expect(failed.olderRequested).toBe(false);
		expect(failed.historyComplete.c1).toBeUndefined();
		expect(reduce(failed, { type: "older-requested" }).olderRequested).toBe(true);
	});

	test("selecting another thread drops a request made in the old one", () => {
		// Otherwise the pending flag survives the move, the effect re-runs for the new
		// conversation and loads a page nobody asked for — shifting that pane.
		const other: Conversation = { ...conversation, id: "c2", name: "Bob" };
		const state = loaded(newestPage(), {
			conversations: [conversation, other],
			olderRequested: true,
		});

		const moved = reduce(state, { type: "move-selection", delta: 1 });

		expect(moved.selectedId).toBe("c2");
		expect(moved.olderRequested).toBe(false);
	});

	test("a conversation leaving the list drops it too", () => {
		const state = loaded(newestPage(), { olderRequested: true });

		const reloaded = reduce(state, { type: "conversations-loaded", conversations: [] });

		expect(reloaded.olderRequested).toBe(false);
	});

	test("an older arrival reopens a thread that looked finished", () => {
		// A message delivered out of order (or a replay of an old envelope) sits behind the
		// page boundary, and the newest-N reload will never show it. Without this the pane
		// would refuse to walk back to it until the app restarted.
		const complete = loaded(newestPage(), { historyComplete: { c1: true } });
		expect(reduce(complete, { type: "older-requested" })).toBe(complete);

		const reopened = reduce(complete, { type: "history-invalidated", conversationId: "c1" });
		expect(reopened.historyComplete.c1).toBeUndefined();
		expect(reduce(reopened, { type: "older-requested" }).olderRequested).toBe(true);
	});

	test("invalidating a thread that was never finished changes nothing", () => {
		const state = loaded(newestPage());

		expect(reduce(state, { type: "history-invalidated", conversationId: "c1" })).toBe(state);
	});
});

describe("a reload keeps the history behind it", () => {
	test("pages walked back to survive an incoming message", async () => {
		// The reload trigger is every envelope: without this, opening a page and then
		// receiving a message would throw the page away and jump the pane forward.
		const withHistory = loaded([...olderPage(), ...newestPage()], { scroll: 50 });

		const next = reduce(withHistory, {
			type: "messages-loaded",
			conversationId: "c1",
			messages: [...newestPage(), message(100)],
		});

		expect(next.messagesByConversation.c1).toHaveLength(101);
		expect(next.messagesByConversation.c1?.[0]?.body).toBe("message-0");
		expect(next.messagesByConversation.c1?.at(-1)?.body).toBe("message-100");
	});

	test("a gap between kept history and the fresh page is not papered over", () => {
		// Thread A left unselected while more than a page arrived: the newest slice no longer
		// reaches back to what was kept, and every kept row is older than it, so the merge
		// would show a hole. Paging walks from the first row, so the hole would be
		// unreachable — drop the prefix and let the thread be walked again.
		const stale = loaded([...olderPage(), ...newestPage()], {
			scroll: 50,
			historyComplete: { c1: true },
		});

		const next = reduce(stale, {
			type: "messages-loaded",
			conversationId: "c1",
			messages: Array.from({ length: 50 }, (_unused, index) => message(300 + index)),
		});

		expect(next.messagesByConversation.c1).toHaveLength(50);
		expect(next.messagesByConversation.c1?.[0]?.body).toBe("message-300");
		// The beginning is no longer known: rows behind the boundary were never read.
		expect(next.historyComplete.c1).toBeUndefined();
	});

	test("an overlapping reload keeps the history and the completion mark", () => {
		const withHistory = loaded([...olderPage(), ...newestPage()], {
			scroll: 50,
			historyComplete: { c1: true },
		});

		const next = reduce(withHistory, {
			type: "messages-loaded",
			conversationId: "c1",
			messages: [...newestPage(), message(100)],
		});

		expect(next.messagesByConversation.c1).toHaveLength(101);
		expect(next.historyComplete.c1).toBe(true);
	});

	test("an offset past the end of the thread is clamped", () => {
		const state = loaded(newestPage(), { scroll: 49 });

		const next = reduce(state, {
			type: "messages-loaded",
			conversationId: "c1",
			messages: [message(50)],
		});

		expect(next.scroll).toBe(0);
	});
});
