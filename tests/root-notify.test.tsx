import { describe, expect, test } from "bun:test";
import { render } from "ink-testing-library";
import { InMemoryStore } from "../src/adapters/memory/store";
import type { IncomingNotice, Session } from "../src/app/session";
import type { Message } from "../src/domain/types";
import { Root } from "../src/ui/Root";
import { waitFor } from "./helpers/wait";

/** Only what `Root` touches: a change listener, the incoming feed, and markRead on open. */
const fakeSession = (): { session: Session; incoming: (notice: IncomingNotice) => void } => {
	let incoming: (notice: IncomingNotice) => void = () => undefined;
	return {
		session: {
			start: async () => undefined,
			stop: async () => undefined,
			send: async () => undefined,
			markRead: async () => undefined,
			react: async () => undefined,
			edit: async () => undefined,
			remove: async () => undefined,
			hide: async () => undefined,
			flush: async () => undefined,
			onChange: () => () => undefined,
			onIncoming: (listener) => {
				incoming = listener;
				return () => {
					incoming = () => undefined;
				};
			},
			errors: [],
		},
		incoming: (notice) => incoming(notice),
	};
};

const message = (conversationId: string, overrides: Partial<Message> = {}): Message => ({
	id: `${conversationId}:9000`,
	conversationId,
	author: "Mum",
	authorId: "uuid-mum",
	body: "dinner at 7?",
	sentAt: 9_000,
	isOutgoing: false,
	isDeleted: false,
	...overrides,
});

const toasts = (chunks: readonly string[]): string[] =>
	chunks.filter((chunk) => chunk.includes("\u001b]9;"));

/** Renders `Root` and collects everything it writes, with a stable writer for the effect. */
const rendered = (
	notify = true,
): {
	written: string[];
	incoming: (notice: IncomingNotice) => void;
} => {
	const chunks: string[] = [];
	const write = (chunk: string): void => {
		chunks.push(chunk);
	};
	const { session, incoming } = fakeSession();
	render(<Root store={new InMemoryStore()} session={session} write={write} notify={notify} />);
	return { written: chunks, incoming };
};

/**
 * The feature only exists if it fires for the right message: one toast for another thread,
 * none for the thread on screen — both driven through the same path, in one run, so a
 * `Root` that never subscribes at all fails here rather than passing quietly.
 */
describe("Root notifications", () => {
	test("toasts another thread once and the open one not at all", async () => {
		const { written, incoming } = rendered();
		// Only the loaded store has an unread total: waiting for it is waiting for the
		// conversation list, and therefore for the selection the check compares against.
		await waitFor(() => written.some((chunk) => chunk.includes("9 unread")), "the store to load");

		// The demo store opens on "Signal devs"; Family is another thread.
		incoming({ message: message("c-family"), conversationName: "Family" });
		incoming({ message: message("c-signal-devs"), conversationName: "Signal devs" });

		await waitFor(() => toasts(written).length > 0, "a toast");
		const seen = toasts(written);
		expect(seen).toHaveLength(1);
		expect(seen[0]).toContain("Family · Mum: dinner at 7?");
	});

	test("keeps the unread count in the window title", async () => {
		const { written } = rendered();

		// 2 + 7 unread in the demo data: a fixed title would pass a word-match.
		await waitFor(
			() => written.some((chunk) => chunk.includes("\u001b]2;signal-tui · 9 unread")),
			"the unread title",
		);
	});

	test("with notifications off, the same arrival says nothing at all", async () => {
		// Bracketed by a positive control: the same notice, through the same path, with the
		// preference on, has to produce a toast — otherwise the empty list below would pass
		// for a writer that was never subscribed.
		const off = rendered(false);
		await waitFor(
			() => off.written.some((chunk) => chunk.includes("9 unread")),
			"the store to load",
		);
		off.incoming({ message: message("c-family"), conversationName: "Family" });
		await waitFor(
			() => off.written.some((chunk) => chunk.includes("\u001b]2;")),
			"the title, which is not a notification",
		);
		expect(toasts(off.written)).toHaveLength(0);

		const on = rendered();
		await waitFor(
			() => on.written.some((chunk) => chunk.includes("9 unread")),
			"the store to load",
		);
		on.incoming({ message: message("c-family"), conversationName: "Family" });
		await waitFor(() => toasts(on.written).length === 1, "the same arrival to toast");
	});
});
