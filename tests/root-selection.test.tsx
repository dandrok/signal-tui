import { describe, expect, test } from "bun:test";
import { render } from "ink-testing-library";
import { InMemoryStore } from "../src/adapters/memory/store";
import type { Session } from "../src/app/session";
import { Root } from "../src/ui/Root";
import { plain } from "./helpers/frame";

const tick = (ms = 120): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Only the surface `Root` touches: a change listener, plus markRead on open. */
const fakeSession = (): { session: Session; notify: () => void } => {
	let listener: (() => void) | null = null;
	return {
		session: {
			start: async () => undefined,
			stop: async () => undefined,
			send: async () => undefined,
			markRead: async () => undefined,
			flush: async () => undefined,
			onChange: (next) => {
				listener = next;
				return () => {
					listener = null;
				};
			},
			onIncoming: () => () => undefined,
			errors: [],
		},
		notify: () => listener?.(),
	};
};

/**
 * The reported bug, through the real store and a real frame: a message in a
 * conversation below the fold moves that conversation to the top of the list, and
 * the pane used to follow the row instead — so the person at that row replaced the
 * one being read.
 */
describe("the pane follows the person, not the row", () => {
	test("a conversation bumped to the top keeps the thread on screen", async () => {
		const store = new InMemoryStore();
		const { session, notify } = fakeSession();
		const { stdin, lastFrame, unmount } = render(<Root store={store} session={session} />);
		await tick();

		// Second row: Alice. Her thread is what the pane is showing.
		stdin.write("j");
		await tick();
		expect(plain(lastFrame() ?? "")).toContain("can we ship before friday?");

		// A message lands in Family, which moves it to the top of the list.
		await store.upsertConversation({
			id: "c-family",
			name: "Family",
			unreadCount: 8,
			lastActivityAt: 9_999_999_999_999,
		});
		notify();
		await tick();

		const frame = plain(lastFrame() ?? "");
		// The list really did reorder — Family is now above Alice…
		expect(frame.indexOf("Family")).toBeGreaterThan(-1);
		expect(frame.indexOf("Family")).toBeLessThan(frame.indexOf("Alice"));
		// …and the pane still shows the conversation that was selected.
		expect(frame).toContain("can we ship before friday?");
		unmount();
	});

	test("moving the selection after a reorder moves from where the person is", async () => {
		const store = new InMemoryStore();
		const { session, notify } = fakeSession();
		const { stdin, lastFrame, unmount } = render(<Root store={store} session={session} />);
		await tick();

		stdin.write("j");
		await tick();
		await store.upsertConversation({
			id: "c-family",
			name: "Family",
			unreadCount: 8,
			lastActivityAt: 9_999_999_999_999,
		});
		notify();
		await tick();

		// Alice is now the third row, so one step down is the fourth conversation.
		stdin.write("j");
		await tick();

		const frame = plain(lastFrame() ?? "");
		// The note thread's own body, not its name: "Note to self" is in the list
		// whichever conversation is open, so asserting it would pass on the wrong one.
		expect(frame).toContain("FTS5 index before v0.1");
		expect(frame).not.toContain("can we ship before friday?");
		unmount();
	});
});
