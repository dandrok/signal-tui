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
