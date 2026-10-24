import { describe, expect, test } from "bun:test";
import { render } from "ink-testing-library";
import { useState } from "react";
import { demoConversations, demoMessages } from "../src/adapters/memory/demo-data";
import type { Action, AppState } from "../src/app/state";
import { emptyState, reduce } from "../src/app/state";
import { App } from "../src/ui/App";
import { plain } from "./helpers/frame";

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

function Harness({
	initial,
	onAction,
}: {
	readonly initial: AppState;
	readonly onAction?: (action: Action) => void;
}) {
	const [state, setState] = useState<AppState>(initial);
	const dispatch = (action: Action): void => {
		onAction?.(action);
		setState((current) => reduce(current, action));
	};
	return <App state={state} dispatch={dispatch} />;
}

describe("App", () => {
	test("renders the selected conversation and its messages", () => {
		const { lastFrame } = render(<Harness initial={seededState()} />);
		const frame = plain(lastFrame() ?? "");
		expect(frame).toContain("Conversations");
		expect(frame).toContain("Signal devs");
		expect(frame).toContain("pushed the fix, ptal");
		expect(frame).toContain("j/k move");
	});

	test("j moves the selection and swaps the message pane", async () => {
		const { lastFrame, stdin } = render(<Harness initial={seededState()} />);
		stdin.write("j");
		await tick();
		const frame = plain(lastFrame() ?? "");
		expect(frame).toContain("can we ship before friday?");
		expect(frame).not.toContain("pushed the fix, ptal");
	});

	test("i focuses the composer and typed text lands in the draft", async () => {
		const { lastFrame, stdin } = render(<Harness initial={seededState()} />);
		stdin.write("i");
		await tick();
		stdin.write("hey");
		await tick();
		expect(plain(lastFrame() ?? "")).toContain("hey");
	});

	test("escape leaves the composer without losing the draft", async () => {
		const { lastFrame, stdin } = render(<Harness initial={seededState()} />);
		stdin.write("i");
		await tick();
		stdin.write("draft one");
		await tick();
		stdin.write("\u001b");
		await tick();
		const frame = plain(lastFrame() ?? "");
		// Back to the message pane, which is where you look after writing.
		expect(frame).toContain("j/k scroll");
		expect(frame).toContain("draft one");
	});

	test("tab moves the keyboard to the message pane", async () => {
		const actions: Action[] = [];
		const { lastFrame, stdin, unmount } = render(
			<Harness initial={seededState()} onAction={(action) => actions.push(action)} />,
		);
		await tick();

		stdin.write("	");
		await tick();
		expect(plain(lastFrame() ?? "")).toContain("j/k scroll");

		// j belongs to the message pane now. Asserting the dispatched action
		// rather than the frame: from `scroll: 0` a `scroll-moved` of -1 clamps to
		// zero, so the frame looks identical whether or not j was routed anywhere.
		actions.length = 0;
		stdin.write("j");
		await tick();
		expect(actions).toEqual([{ type: "scroll-moved", delta: -1 }]);
		unmount();
	});

	test("tab leaves the composer instead of typing a tab into the draft", async () => {
		const actions: Action[] = [];
		const { stdin, unmount } = render(
			<Harness initial={seededState()} onAction={(action) => actions.push(action)} />,
		);
		await tick();

		stdin.write("i");
		await tick();
		stdin.write("hi");
		await tick();
		actions.length = 0;
		stdin.write("	");
		await tick();

		expect(actions).toEqual([{ type: "focus-next" }]);
		unmount();
	});

	test("shift-tab walks back to the composer", async () => {
		const { lastFrame, stdin } = render(<Harness initial={seededState()} />);
		await tick();

		stdin.write("\u001b[Z");
		await tick();
		expect(plain(lastFrame() ?? "")).toContain("⏎ send");
	});
});

describe("search pane", () => {
	test("opens with / and shows what is typed", async () => {
		const { stdin, lastFrame, unmount } = render(<Harness initial={seededState()} />);
		await tick();

		stdin.write("/");
		await tick();
		stdin.write("dinner");
		await tick();

		const frame = plain(lastFrame() ?? "");
		expect(frame).toContain("Search");
		expect(frame).toContain("dinner");
		unmount();
	});

	test("escape returns to the conversation list", async () => {
		const { stdin, lastFrame, unmount } = render(<Harness initial={seededState()} />);
		await tick();

		stdin.write("/");
		await tick();
		expect(plain(lastFrame() ?? "")).toContain("Search");

		stdin.write("\u001B");
		await tick();
		expect(plain(lastFrame() ?? "")).not.toContain("Search  ");
		unmount();
	});
});
