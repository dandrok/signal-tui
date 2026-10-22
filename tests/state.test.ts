import { describe, expect, test } from "bun:test";
import { demoConversations, demoMessages } from "../src/adapters/memory/demo-data";
import { emptyState, reduce, selectedConversation, selectedMessages } from "../src/app/state";

const loaded = () =>
	reduce(emptyState, { type: "conversations-loaded", conversations: demoConversations });

describe("reduce", () => {
	test("loading conversations keeps the selection at zero", () => {
		const state = loaded();
		expect(state.conversations).toHaveLength(4);
		expect(state.selectedIndex).toBe(0);
		expect(selectedConversation(state)?.id).toBe("c-signal-devs");
	});

	test("move-selection clamps instead of wrapping", () => {
		let state = loaded();
		state = reduce(state, { type: "move-selection", delta: -1 });
		expect(state.selectedIndex).toBe(0);

		state = reduce(state, { type: "move-selection", delta: 99 });
		expect(state.selectedIndex).toBe(demoConversations.length - 1);
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

	test("submitting a draft clears it and sets a notice", () => {
		let state = reduce(loaded(), { type: "focus", focus: "composer" });
		state = reduce(state, { type: "draft-changed", value: "  hello  " });
		state = reduce(state, { type: "draft-submitted" });
		expect(state.draft).toBe("");
		expect(state.notice).toBe("queued: hello");
	});

	test("submitting an empty draft changes nothing", () => {
		const state = reduce(loaded(), { type: "draft-changed", value: "   " });
		expect(reduce(state, { type: "draft-submitted" })).toBe(state);
	});

	test("typing after a send clears the notice", () => {
		let state = reduce(loaded(), { type: "focus", focus: "composer" });
		state = reduce(state, { type: "draft-changed", value: "hi" });
		state = reduce(state, { type: "draft-submitted" });
		expect(state.notice).toBe("queued: hi");

		state = reduce(state, { type: "draft-changed", value: "h" });
		expect(state.notice).toBeNull();
	});

	test("setting the same focus returns the same object", () => {
		const state = loaded();
		expect(reduce(state, { type: "focus", focus: "conversations" })).toBe(state);
	});
});
