import { describe, expect, test } from "bun:test";
import { render } from "ink-testing-library";
import { InMemoryStore } from "../src/adapters/memory/store";
import type { Session } from "../src/app/session";
import type { Attachment, Message } from "../src/domain/types";
import { Root } from "../src/ui/Root";
import { plain } from "./helpers/frame";
import { waitFor } from "./helpers/wait";

/**
 * Forwarding, through the real `Root`: `f` opens the picker, typing narrows it, and enter sends
 * the same words to the conversation it names — as an ordinary send, since Signal has no
 * forward of its own.
 *
 * Two failures this file exists for. An off-by-one destination: a picker that filters with one
 * rule and sends with another forwards somebody's message to a stranger. And a destination that
 * moves: the conversation list is ordered by activity, so a message arriving between `f` and
 * `⏎` reorders it — the picker has to keep aiming at the chat it showed.
 */

const AMBER = "uuid-amber";
const BORIS = "+48123456789";
const CAROL = "uuid-carol";
const SENT_AT = 1_760_000_000_000;

interface Sent {
	readonly conversationId: string;
	readonly body: string;
}

interface Harness {
	readonly session: Session;
	readonly sent: Sent[];
	/** Wakes the UI the way the session does when the cache changed. */
	readonly bump: () => void;
}

const fakeSession = (): Harness => {
	const sent: Sent[] = [];
	const listeners = new Set<() => void>();
	return {
		sent,
		bump: () => {
			for (const listener of listeners) {
				listener();
			}
		},
		session: {
			start: async () => undefined,
			startDirect: async () => undefined,
			listContacts: async () => [],
			stop: async () => undefined,
			send: async (conversationId, body) => {
				sent.push({ conversationId, body });
			},
			markRead: async () => undefined,
			typingIn: () => null,
			react: async () => undefined,
			edit: async () => undefined,
			remove: async () => undefined,
			hide: async () => undefined,
			flush: async () => undefined,
			onChange: (listener) => {
				listeners.add(listener);
				return () => {
					listeners.delete(listener);
				};
			},
			onIncoming: () => () => undefined,
			errors: [],
		},
	};
};

const attachment: Attachment = {
	id: "file-1",
	contentType: "image/jpeg",
	filename: "/tmp/photo.jpg",
	size: 2_048,
	caption: null,
	isVoiceNote: false,
};

/** Amber's thread holds one message; Boris's exists so there is somewhere to forward to. */
const seeded = async (over: Partial<Message> = {}): Promise<InMemoryStore> => {
	const store = new InMemoryStore({ seed: false });
	await store.upsertConversation({
		id: AMBER,
		name: "Amber",
		unreadCount: 0,
		lastActivityAt: SENT_AT,
	});
	await store.upsertConversation({
		id: BORIS,
		name: "Boris",
		unreadCount: 0,
		lastActivityAt: SENT_AT - 60_000,
	});
	await store.saveMessage({
		id: `${AMBER}:${SENT_AT}`,
		conversationId: AMBER,
		author: "Amber",
		authorId: AMBER,
		body: "dinner at 7?",
		sentAt: SENT_AT,
		isOutgoing: false,
		isDeleted: false,
		attachments: [],
		...over,
	});
	return store;
};

type Frame = () => string | undefined;

/** Write one keystroke, then wait for the frame it was meant to change. */
const press = async (
	stdin: { write: (input: string) => void },
	input: string,
	lastFrame: Frame,
	expected?: string,
): Promise<void> => {
	stdin.write(input);
	if (expected !== undefined) {
		await waitFor(
			() => plain(lastFrame() ?? "").includes(expected),
			`“${expected}” after ${JSON.stringify(input)}`,
		);
	}
};

const frameText = (lastFrame: Frame): string => plain(lastFrame() ?? "");

describe("forwarding from the keyboard", () => {
	test("f opens the picker on the first other chat, and enter sends the words there", async () => {
		const store = await seeded();
		const { session, sent } = fakeSession();
		const { stdin, lastFrame, unmount } = render(<Root store={store} session={session} />);

		await waitFor(() => frameText(lastFrame).includes("dinner at 7?"), "the thread to load");
		await press(stdin, "\t", lastFrame, "f forward");
		await press(stdin, "f", lastFrame, "forward ›");

		// One other conversation, and it is highlighted before anything is typed.
		await waitFor(
			() => frameText(lastFrame).includes("Boris 1/1"),
			"the picker to name its destination",
		);
		await press(stdin, "\r", lastFrame, "forwarded to Boris");

		expect(sent).toEqual([{ conversationId: BORIS, body: "dinner at 7?" }]);
		// The prompt closed, and the status line says where the copy went.
		expect(frameText(lastFrame)).not.toContain("forward ›");
		unmount();
	});

	test("typing narrows the picker, and the highlight decides the destination", async () => {
		const store = await seeded();
		// A second destination: with one conversation a filter cannot be seen to work.
		await store.upsertConversation({
			id: CAROL,
			name: "Carol",
			unreadCount: 0,
			lastActivityAt: SENT_AT - 120_000,
		});
		const { session, sent } = fakeSession();
		const { stdin, lastFrame, unmount } = render(<Root store={store} session={session} />);

		await waitFor(() => frameText(lastFrame).includes("dinner at 7?"), "the thread to load");
		await press(stdin, "\t", lastFrame, "f forward");
		await press(stdin, "f", lastFrame, "forward ›");
		await waitFor(() => frameText(lastFrame).includes("Boris 1/2"), "both destinations");
		await press(stdin, "car", lastFrame, "Carol 1/1");
		await press(stdin, "\r", lastFrame, "forwarded to Carol");

		expect(sent).toEqual([{ conversationId: CAROL, body: "dinner at 7?" }]);
		unmount();
	});

	test("a chat that climbs the list while the picker is open does not take the message", async () => {
		// The list is ordered by activity. Carol gets a message after the picker opened, which
		// puts her first — and an index resolved against the live list would now name her.
		const store = await seeded();
		await store.upsertConversation({
			id: CAROL,
			name: "Carol",
			unreadCount: 0,
			lastActivityAt: SENT_AT - 120_000,
		});
		const { session, sent, bump } = fakeSession();
		const { stdin, lastFrame, unmount } = render(<Root store={store} session={session} />);

		await waitFor(() => frameText(lastFrame).includes("dinner at 7?"), "the thread to load");
		await press(stdin, "\t", lastFrame, "f forward");
		await press(stdin, "f", lastFrame, "forward ›");
		await waitFor(() => frameText(lastFrame).includes("Boris 1/2"), "both destinations");

		// Carol now outranks everyone, and the UI is woken the way an arriving message wakes it.
		await store.upsertConversation({
			id: CAROL,
			name: "Carol",
			unreadCount: 1,
			lastActivityAt: SENT_AT + 1_000,
		});
		bump();
		await waitFor(
			() => frameText(lastFrame).indexOf("Carol") < frameText(lastFrame).indexOf("Boris"),
			"the list to reorder",
		);

		// The picker still says Boris, so enter still means Boris.
		expect(frameText(lastFrame)).toContain("Boris 1/2");
		await press(stdin, "\r", lastFrame, "forwarded to Boris");

		expect(sent).toEqual([{ conversationId: BORIS, body: "dinner at 7?" }]);
		unmount();
	});

	test("escape leaves without sending anything", async () => {
		const store = await seeded();
		const { session, sent } = fakeSession();
		const { stdin, lastFrame, unmount } = render(<Root store={store} session={session} />);

		await waitFor(() => frameText(lastFrame).includes("dinner at 7?"), "the thread to load");
		await press(stdin, "\t", lastFrame, "f forward");
		await press(stdin, "f", lastFrame, "forward ›");
		await press(stdin, "\u001b", lastFrame);

		expect(sent).toEqual([]);
		await waitFor(() => !frameText(lastFrame).includes("forward ›"), "the prompt to close");
		unmount();
	});

	test("a filter that matches nobody sends nothing and says so", async () => {
		const store = await seeded();
		const { session, sent } = fakeSession();
		const { stdin, lastFrame, unmount } = render(<Root store={store} session={session} />);

		await waitFor(() => frameText(lastFrame).includes("dinner at 7?"), "the thread to load");
		await press(stdin, "\t", lastFrame, "f forward");
		await press(stdin, "f", lastFrame, "forward ›");
		await press(stdin, "zzz", lastFrame, "no chat matches");
		await press(stdin, "\r", lastFrame, "no conversation matches that");

		expect(sent).toEqual([]);
		unmount();
	});

	test("a message with a file is not offered, and f refuses out loud", async () => {
		const store = await seeded({ body: "look", attachments: [attachment] });
		const { session, sent } = fakeSession();
		const { stdin, lastFrame, unmount } = render(<Root store={store} session={session} />);

		await waitFor(() => frameText(lastFrame).includes("look"), "the thread to load");
		await press(stdin, "\t", lastFrame, "r reply");
		// Not advertised: the key would do nothing but refuse.
		expect(frameText(lastFrame)).not.toContain("f forward");

		await press(stdin, "f", lastFrame, "forwarding sends text only");

		expect(frameText(lastFrame)).not.toContain("forward ›");
		expect(sent).toEqual([]);
		unmount();
	});
});
