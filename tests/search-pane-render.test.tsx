import { describe, expect, test } from "bun:test";
import { render } from "ink-testing-library";
import type { Message } from "../src/domain/types";
import { SearchPane } from "../src/ui/SearchPane";

const hit = (id: string, body: string): Message => ({
	id,
	conversationId: "conv",
	author: "Alice",
	body,
	sentAt: 1,
	isOutgoing: false,
	isDeleted: false,
});

const hits = (count: number): Message[] =>
	Array.from({ length: count }, (_, i) => hit(`m${i}`, `hit ${i}`));

describe("SearchPane", () => {
	test("counts every result outside the window, not just those below it", () => {
		// height 10 minus border/chrome leaves room for 5 results; the selection is at
		// the end, so 15 sit above the window and none below.
		const { lastFrame, unmount } = render(
			<SearchPane
				search={{ query: "hit", results: hits(20), selectedIndex: 19, ran: true }}
				width={80}
				height={10}
			/>,
		);

		const frame = lastFrame() ?? "";
		expect(frame).toContain("15 other results");
		expect(frame).not.toContain("+0 more");
		unmount();
	});

	test("says nothing about extra results when they all fit", () => {
		const { lastFrame, unmount } = render(
			<SearchPane
				search={{ query: "hit", results: hits(3), selectedIndex: 0, ran: true }}
				width={80}
				height={20}
			/>,
		);

		const frame = lastFrame() ?? "";
		// Absence alone would also hold for a pane that renders nothing at all.
		expect(frame).toContain("hit 0");
		expect(frame).toContain("hit 1");
		expect(frame).toContain("hit 2");
		expect(frame).not.toContain("other result");
		unmount();
	});

	test("breaks lines on one hit without saying 'results'", () => {
		const { lastFrame, unmount } = render(
			<SearchPane
				search={{ query: "hit", results: hits(9), selectedIndex: 8, ran: true }}
				width={80}
				height={10}
			/>,
		);

		const frame = lastFrame() ?? "";
		expect(frame).toContain("4 other results");
		unmount();
	});

	test("shows a deleted message as deleted, never its body", () => {
		const deleted: Message = { ...hit("gone", "secret text"), isDeleted: true };
		const { lastFrame, unmount } = render(
			<SearchPane
				search={{ query: "secret", results: [deleted], selectedIndex: 0, ran: true }}
				width={80}
				height={12}
			/>,
		);

		const frame = lastFrame() ?? "";
		expect(frame).not.toContain("secret text");
		expect(frame).toContain("message deleted");
		unmount();
	});
});
