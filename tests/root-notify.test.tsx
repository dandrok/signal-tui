import { describe, expect, test } from "bun:test";
import { render } from "ink-testing-library";
import { InMemoryStore } from "../src/adapters/memory/store";
import type { IncomingNotice, Session } from "../src/app/session";
import type { Message } from "../src/domain/types";
import { Root } from "../src/ui/Root";

const tick = (ms = 150): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Only what `Root` touches: a change listener, the incoming feed, and markRead on open. */
const fakeSession = (): { session: Session; incoming: (notice: IncomingNotice) => void } => {
	let incoming: (notice: IncomingNotice) => void = () => undefined;
	return {
		session: {
			start: async () => undefined,
			stop: async () => undefined,
			send: async () => undefined,
			markRead: async () => undefined,
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

/**
 * The feature only exists if it fires for the right message: a toast for the thread on
 * screen would be noise, and a toast for nothing at all is the reason people turn
 * notifications off.
 */
describe("Root notifications", () => {
	test("announces a message in a conversation nobody is looking at", async () => {
		const { session, incoming } = fakeSession();
		const written: string[] = [];
		render(
			<Root store={new InMemoryStore()} session={session} write={(chunk) => written.push(chunk)} />,
		);
		await tick();

		// The demo store opens on "Signal devs"; Family is another thread.
		incoming({ message: message("c-family"), conversationName: "Family" });
		await tick();

		const seen = toasts(written);
		expect(seen).toHaveLength(1);
		expect(seen[0]).toContain("Family · Mum: dinner at 7?");
	});

	test("says nothing for the conversation on screen", async () => {
		const { session, incoming } = fakeSession();
		const written: string[] = [];
		render(
			<Root store={new InMemoryStore()} session={session} write={(chunk) => written.push(chunk)} />,
		);
		await tick();

		incoming({ message: message("c-signal-devs"), conversationName: "Signal devs" });
		await tick();

		expect(toasts(written)).toEqual([]);
	});

	test("keeps the unread count in the window title", async () => {
		const { session } = fakeSession();
		const written: string[] = [];
		render(
			<Root store={new InMemoryStore()} session={session} write={(chunk) => written.push(chunk)} />,
		);
		await tick();

		// The demo data ships unread messages: 2 + 7 across the store.
		const titles = written.filter((chunk) => chunk.includes("\u001b]2;"));
		expect(titles.at(-1)).toContain("unread");
	});
});
