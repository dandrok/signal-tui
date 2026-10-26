import { describe, expect, test } from "bun:test";
import type { AppState } from "../src/app/state";
import { emptyState, pointedMessage, reduce, replyTarget } from "../src/app/state";
import type { Conversation, Message } from "../src/domain/types";

const conversation = (id = "c1"): Conversation => ({
	id,
	name: "Signal devs",
	unreadCount: 0,
	lastActivityAt: 3,
});

const message = (overrides: Partial<Message> = {}): Message => ({
	id: "c1:1000",
	conversationId: "c1",
	author: "Marta",
	authorId: "uuid-marta",
	body: "the original",
	sentAt: 1_000,
	isOutgoing: false,
	isDeleted: false,
	...overrides,
});

const loaded = (messages: readonly Message[], overrides: Partial<AppState> = {}): AppState => ({
	...emptyState,
	conversations: [conversation()],
	selectedId: "c1",
	messagesByConversation: { c1: messages },
	focus: "messages",
	...overrides,
});

const thread = (): readonly Message[] => [
	message({ id: "c1:1000", sentAt: 1_000 }),
	message({ id: "c1:2000", sentAt: 2_000, body: "and another" }),
];

describe("the message a reply would answer", () => {
	test("is the bottom-most message in the window", () => {
		// No separate cursor: the scroll offset already names one, so `j`/`k` keep their
		// meaning and a selection can never sit off screen.
		expect(pointedMessage(loaded(thread()))?.id).toBe("c1:2000");
		expect(pointedMessage(loaded(thread(), { scroll: 1 }))?.id).toBe("c1:1000");
	});

	test("never scrolls past the oldest message", () => {
		expect(pointedMessage(loaded(thread(), { scroll: 99 }))?.id).toBe("c1:1000");
	});

	test("is undefined in an empty thread", () => {
		expect(pointedMessage(loaded([]))).toBeUndefined();
	});
});

describe("starting a reply", () => {
	test("marks the pointed message and hands over the keyboard", () => {
		const next = reduce(loaded(thread()), { type: "reply-started" });

		expect(next.replyToId).toBe("c1:2000");
		expect(next.focus).toBe("composer");
	});

	test("refuses a message that is gone", () => {
		// A delete-for-everyone, an expired row and a view-once message have nothing to
		// quote, so `r` must not put the composer into a reply it cannot send.
		for (const gone of [
			message({ isDeleted: true, body: "" }),
			message({ isExpired: true, body: "" }),
			message({ isViewOnce: true, body: "" }),
			// A row cached before schema v4 has no author id to send, so it cannot be answered.
			{
				id: "c1:1000",
				conversationId: "c1",
				author: "Marta",
				body: "the original",
				sentAt: 1_000,
				isOutgoing: false,
				isDeleted: false,
			} satisfies Message,
		]) {
			const state = loaded([gone]);
			expect(reduce(state, { type: "reply-started" })).toBe(state);
			expect(replyTarget(state)).toBeNull();
		}
	});

	test("cancelling drops the target and goes back to the pane", () => {
		const started = reduce(loaded(thread()), { type: "reply-started" });
		const cancelled = reduce(started, { type: "reply-cancelled" });

		expect(cancelled.replyToId).toBeNull();
		expect(cancelled.focus).toBe("messages");
	});

	test("switching conversation drops it", () => {
		const started = reduce(loaded(thread()), { type: "reply-started" });
		const other = {
			...started,
			conversations: [conversation("c1"), conversation("c2")],
		};

		expect(reduce(other, { type: "move-selection", delta: 1 }).replyToId).toBeNull();
	});

	test("a target that disappears from the thread drops it", () => {
		// The row can be deleted or purged while the draft is being written; the composer
		// must stop claiming to answer something that is no longer there.
		const started = reduce(loaded(thread()), { type: "reply-started" });
		const next = reduce(started, {
			type: "messages-loaded",
			conversationId: "c1",
			messages: [message({ id: "c1:1000", sentAt: 1_000 })],
		});

		expect(next.replyToId).toBeNull();
	});

	test("submitting a draft clears it", () => {
		const started = reduce(loaded(thread(), { draft: "agreed" }), { type: "reply-started" });
		const submitted = reduce(started, { type: "draft-submitted" });

		expect(submitted.replyToId).toBeNull();
		expect(submitted.draft).toBe("");
	});
});

describe("what a submitted draft sends as its reply", () => {
	test("names the target and carries the words", () => {
		// The text goes with the send so recipients can render the quoted block; the cache
		// still keeps only the identity.
		const state = reduce(loaded(thread()), { type: "reply-started" });

		expect(replyTarget(state)).toEqual({
			sentAt: 2_000,
			authorId: "uuid-marta",
			text: "and another",
		});
	});

	test("answers a row whose author id was never cached, in a direct chat", () => {
		// Rows cached before schema v4 have no author id, and this is what made `r` silently
		// do nothing for anything but the newest message. In a direct chat the conversation
		// *is* the peer, so that identity can stand in for the missing one.
		const direct: Conversation = {
			id: "4b1c9f1e-0000-4000-8000-000000000000",
			name: "Marta",
			unreadCount: 0,
			lastActivityAt: 1,
		};
		const legacy: Message = {
			id: "m-legacy",
			conversationId: direct.id,
			author: "Marta",
			body: "written before v4",
			sentAt: 500,
			isOutgoing: false,
			isDeleted: false,
		};
		const state: AppState = {
			...emptyState,
			conversations: [direct],
			selectedId: direct.id,
			messagesByConversation: { [direct.id]: [legacy] },
			focus: "messages",
		};

		expect(reduce(state, { type: "reply-started" }).replyToId).toBe("m-legacy");
		expect(replyTarget(reduce(state, { type: "reply-started" }))).toEqual({
			sentAt: 500,
			authorId: direct.id,
			text: "written before v4",
		});
	});

	test("still refuses one in a group, where a name is not an identifier", () => {
		const group: Conversation = {
			id: "dGhpcyBpcyBhIGdyb3VwIGlkPQ==",
			name: "Signal devs",
			unreadCount: 0,
			lastActivityAt: 1,
		};
		const legacy: Message = {
			id: "m-group-legacy",
			conversationId: group.id,
			author: "Marta",
			body: "written before v4",
			sentAt: 500,
			isOutgoing: false,
			isDeleted: false,
		};
		const state: AppState = {
			...emptyState,
			conversations: [group],
			selectedId: group.id,
			messagesByConversation: { [group.id]: [legacy] },
			focus: "messages",
		};

		expect(reduce(state, { type: "reply-started" })).toBe(state);
	});

	test("is null when no reply was started", () => {
		expect(replyTarget(loaded(thread()))).toBeNull();
	});
});
