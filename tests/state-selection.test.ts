import { describe, expect, test } from "bun:test";
import { demoConversations, demoMessages } from "../src/adapters/memory/demo-data";
import type { AppState } from "../src/app/state";
import {
	emptyState,
	reduce,
	selectedConversation,
	selectedIndex,
	selectedMessages,
} from "../src/app/state";

const loaded = () =>
	reduce(emptyState, { type: "conversations-loaded", conversations: demoConversations });

/**
 * The reported bug: sending a message in a conversation below the fold bumps it to
 * the top of the list, and the pane used to follow the *row* — so whoever moved into
 * row 3 (Adam, say) replaced the person being read.
 */
describe("selection follows the conversation, not its row", () => {
	/** Three conversations, with `picked` selected. */
	const pick = (pickedIndex: number): AppState => {
		let state = loaded();
		state = reduce(state, { type: "move-selection", delta: pickedIndex });
		return state;
	};

	test("a conversation bumped to the top keeps the pane on the person", () => {
		const state = pick(2);
		const picked = selectedConversation(state);
		expect(picked).toBeDefined();

		// Their own new message makes them the most recent, so the list is re-sorted.
		const bumped = [
			{ ...(picked as NonNullable<typeof picked>), lastActivityAt: 9_999 },
			...state.conversations.filter((entry) => entry.id !== picked?.id),
		];
		const after = reduce(state, { type: "conversations-loaded", conversations: bumped });

		expect(selectedIndex(after)).toBe(0);
		// The row changed; the conversation did not.
		expect(selectedConversation(after)?.id).toBe(picked?.id);
	});

	test("another conversation arriving at the top does not move the pane", () => {
		const state = pick(1);
		const picked = selectedConversation(state);
		const stranger = { id: "c-stranger", name: "Adam", unreadCount: 1, lastActivityAt: 9_999 };
		const after = reduce(state, {
			type: "conversations-loaded",
			conversations: [stranger, ...state.conversations],
		});

		// The person is still selected, one row lower than before.
		expect(selectedConversation(after)?.id).toBe(picked?.id);
		expect(selectedIndex(after)).toBe(2);
	});

	test("the messages drawn belong to the selected conversation after a reorder", () => {
		const state = pick(1);
		const picked = selectedConversation(state);
		expect(picked?.id).toBe("c-alice");
		const withMessages = reduce(state, {
			type: "messages-loaded",
			conversationId: "c-alice",
			messages: demoMessages.filter((message) => message.conversationId === "c-alice"),
		});
		const after = reduce(withMessages, {
			type: "conversations-loaded",
			conversations: [...withMessages.conversations].reverse(),
		});

		const drawn = selectedMessages(after);
		expect(drawn.map((message) => message.id)).toEqual(["m-4", "m-5"]);
		expect(
			drawn.every((message) => message.conversationId === selectedConversation(after)?.id),
		).toBe(true);
	});

	test("a conversation that leaves the list moves the cursor to the top", () => {
		const state = pick(3);
		const gone = selectedConversation(state);
		const after = reduce(state, {
			type: "conversations-loaded",
			conversations: state.conversations.filter((entry) => entry.id !== gone?.id),
		});

		expect(selectedConversation(after)?.id).toBe(demoConversations[0]?.id);
		expect(after.scroll).toBe(0);
	});
});
