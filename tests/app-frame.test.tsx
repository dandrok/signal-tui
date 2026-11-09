import { describe, expect, test } from "bun:test";
import { render } from "ink-testing-library";
import type { AppState } from "../src/app/state";
import { emptyState } from "../src/app/state";
import type { Conversation, Message } from "../src/domain/types";
import { SELF_AUTHOR_ID } from "../src/domain/types";
import { App } from "../src/ui/App";
import { plain } from "./helpers/frame";

/**
 * The frame the app writes has to be exactly as tall as the terminal, and no line may be
 * wider than it. Ink redraws by moving the cursor up over the rows it believes it wrote, so
 * a frame that is one row taller scrolls the screen and every redraw then lands a row off:
 * the damage shows up as message rows drawn over one another — a header with its time and
 * author overwritten by the next body, a body merged into the row above it.
 *
 * `useTerminalSize` reads `process.stdout`, while ink lays out against the stdout it was
 * given (the test double's is 100 columns), so both are pinned to the same size here.
 */

const conversation: Conversation = {
	id: "c1",
	name: "Madzia",
	unreadCount: 0,
	lastActivityAt: Date.UTC(2026, 10, 9, 10, 0),
};

/**
 * Alternating senders, so every message starts a run and draws a header of its own: the
 * header is the row the pane loses first when the frame is squeezed.
 */
function thread(count: number): readonly Message[] {
	return Array.from({ length: count }, (_, index) => {
		const isOutgoing = index % 2 === 0;
		return {
			id: `c1:${index}`,
			conversationId: "c1",
			author: isOutgoing ? "You" : "Madzia",
			body: `message number ${index} carries enough words to read as a line`,
			sentAt: Date.UTC(2026, 10, 9, 11, 0) + index * 60_000,
			isOutgoing,
			isDeleted: false,
			...(isOutgoing ? { authorId: SELF_AUTHOR_ID } : {}),
		};
	});
}

/** The pointer on our own newest message, which is the longest the status line gets (`e edit`, `d delete`). */
function pointedAtOwnLastMessage(): AppState {
	const messages = thread(25);
	return {
		...emptyState,
		conversations: [conversation],
		messagesByConversation: { c1: messages },
		selectedId: "c1",
		focus: "messages",
		scroll: 0,
	};
}

const SIZES = ["columns", "rows"] as const;

function atTerminalSize(columns: number, rows: number): () => void {
	const sizes = { columns, rows };
	const restore = SIZES.map((key) => {
		const original = Object.getOwnPropertyDescriptor(process.stdout, key);
		Object.defineProperty(process.stdout, key, { value: sizes[key], configurable: true });
		return () => {
			if (original === undefined) {
				Reflect.deleteProperty(process.stdout, key);
				return;
			}
			Object.defineProperty(process.stdout, key, original);
		};
	});
	return () => {
		for (const undo of restore) {
			undo();
		}
	};
}

describe("App frame", () => {
	test("fits the terminal when the status line is long", () => {
		const restore = atTerminalSize(100, 24);
		try {
			const { lastFrame, unmount } = render(
				<App state={pointedAtOwnLastMessage()} dispatch={() => undefined} />,
			);
			const frame = plain(lastFrame() ?? "");
			unmount();
			const lines = frame.split("\n");

			// Exactly the terminal, not one row more: ink redraws relative to what it wrote.
			expect(lines.length).toBe(24);
			expect(Math.max(...lines.map((line) => line.length))).toBeLessThanOrEqual(100);
			// The pane keeps its title, which is the first row a squeezed layout loses.
			expect(frame).toContain("Madzia (25)");
			// Headers survive on their own row: with the frame overflowing, the body of the
			// message below is drawn over the time and the author.
			const headers = lines.filter((line) => /│ [▌▎] (?:▸ )?\d\d:\d\d (You|Madzia)/.test(line));
			expect(headers.length).toBeGreaterThan(1);
		} finally {
			restore();
		}
	});
});
