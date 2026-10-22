import { describe, expect, test } from "bun:test";
import { render } from "ink-testing-library";
import { useState } from "react";
import { demoConversations, demoMessages } from "../src/adapters/memory/demo-data";
import type { Action, AppState } from "../src/app/state";
import { emptyState, reduce } from "../src/app/state";
import { App } from "../src/ui/App";

const tick = (ms = 80): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function seededState(): AppState {
	let state = reduce(emptyState, {
		type: "conversations-loaded",
		conversations: demoConversations,
	});
	for (const conversation of demoConversations) {
		state = reduce(state, {
			type: "messages-loaded",
			conversationId: conversation.id,
			messages: demoMessages.filter((message) => message.conversationId === conversation.id),
		});
	}
	return state;
}

function Harness({ initial }: { readonly initial: AppState }) {
	const [state, setState] = useState<AppState>(initial);
	const dispatch = (action: Action): void => setState((current) => reduce(current, action));
	return <App state={state} dispatch={dispatch} />;
}

describe("App", () => {
	test("renders the selected conversation and its messages", () => {
		const { lastFrame } = render(<Harness initial={seededState()} />);
		const frame = lastFrame() ?? "";
		expect(frame).toContain("Conversations");
		expect(frame).toContain("Signal devs");
		expect(frame).toContain("pushed the fix, ptal");
		expect(frame).toContain("j/k move");
	});

	test("j moves the selection and swaps the message pane", async () => {
		const { lastFrame, stdin } = render(<Harness initial={seededState()} />);
		stdin.write("j");
		await tick();
		const frame = lastFrame() ?? "";
		expect(frame).toContain("can we ship before friday?");
		expect(frame).not.toContain("pushed the fix, ptal");
	});

	test("i focuses the composer and typed text lands in the draft", async () => {
		const { lastFrame, stdin } = render(<Harness initial={seededState()} />);
		stdin.write("i");
		await tick();
		stdin.write("hey");
		await tick();
		expect(lastFrame() ?? "").toContain("hey");
	});

	test("escape leaves the composer without losing the draft", async () => {
		const { lastFrame, stdin } = render(<Harness initial={seededState()} />);
		stdin.write("i");
		await tick();
		stdin.write("draft one");
		await tick();
		stdin.write("\u001b");
		await tick();
		const frame = lastFrame() ?? "";
		expect(frame).toContain("j/k move");
		expect(frame).toContain("draft one");
	});
});
