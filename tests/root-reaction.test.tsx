import { describe, expect, test } from "bun:test";
import { render } from "ink-testing-library";
import { InMemoryStore } from "../src/adapters/memory/store";
import type { Session } from "../src/app/session";
import type { MessageRef } from "../src/domain/message-ref";
import { Root } from "../src/ui/Root";
import { plain } from "./helpers/frame";

/**
 * The whole path, through the real `Root`: a key opens the prompt, typing lands in it, and
 * Enter reaches the session with the message named the way the wire needs it.
 *
 * This is the test that catches a feature which exists in every layer and is wired in none —
 * the failure mode of the reply slice was exactly that, and no reducer or component test
 * could see it.
 */

const tick = (ms = 120): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const CONVERSATION = "4b1c9f1e-0000-4000-8000-000000000000";

const fakeSession = (): {
	session: Session;
	reactions: Array<{
		conversationId: string;
		target: MessageRef;
		emoji: string;
		isRemove: boolean;
	}>;
} => {
	const reactions: Array<{
		conversationId: string;
		target: MessageRef;
		emoji: string;
		isRemove: boolean;
	}> = [];
	return {
		reactions,
		session: {
			start: async () => undefined,
			stop: async () => undefined,
			send: async () => undefined,
			markRead: async () => undefined,
			typingIn: () => null,
			react: async (conversationId, target, emoji, isRemove = false) => {
				reactions.push({ conversationId, target, emoji, isRemove });
			},
			edit: async () => undefined,
			remove: async () => undefined,
			hide: async () => undefined,
			flush: async () => undefined,
			onChange: () => () => undefined,
			onIncoming: () => () => undefined,
			errors: [],
		},
	};
};

const seededStore = async (isDeleted = false): Promise<InMemoryStore> => {
	const store = new InMemoryStore({ seed: false });
	await store.upsertConversation({
		id: CONVERSATION,
		name: "Alice",
		unreadCount: 0,
		lastActivityAt: 1_760_000_000_000,
	});
	await store.saveMessage({
		id: `${CONVERSATION}:1760000000000`,
		conversationId: CONVERSATION,
		author: "Alice",
		authorId: "uuid-alice",
		body: "can we ship before friday?",
		sentAt: 1_760_000_000_000,
		isOutgoing: false,
		isDeleted,
		attachments: [],
	});
	return store;
};

/** Tab to the message pane, then `x`: the two presses that should open a prompt. */
const openPrompt = async (stdin: { write: (input: string) => void }): Promise<void> => {
	stdin.write("\t");
	await tick();
	stdin.write("x");
	await tick();
};

describe("reacting from the keyboard", () => {
	test("x opens a prompt, and Enter sends the emoji to the session", async () => {
		const store = await seededStore();
		const { session, reactions } = fakeSession();
		const { stdin, lastFrame, unmount } = render(<Root store={store} session={session} />);
		await tick();

		stdin.write("\t");
		await tick();
		stdin.write("x");
		await tick();
		// The prompt replaces the composer in place: the box says what the keyboard now does.
		expect(plain(lastFrame() ?? "")).toContain("react ›");

		stdin.write("👍");
		await tick();
		stdin.write("\r");
		await tick();

		expect(reactions).toEqual([
			{
				conversationId: CONVERSATION,
				target: { sentAt: 1_760_000_000_000, authorId: "uuid-alice" },
				emoji: "👍",
				isRemove: false,
			},
		]);
		// The prompt is gone again, so the composer is back.
		expect(plain(lastFrame() ?? "")).not.toContain("react ›");
		unmount();
	});

	test("escape closes the prompt without sending", async () => {
		const store = await seededStore();
		const { session, reactions } = fakeSession();
		const { stdin, lastFrame, unmount } = render(<Root store={store} session={session} />);
		await tick();

		stdin.write("\t");
		await tick();
		stdin.write("x");
		await tick();
		stdin.write("👍");
		await tick();
		stdin.write("\u001b");
		await tick();

		expect(reactions).toEqual([]);
		expect(plain(lastFrame() ?? "")).not.toContain("react ›");
		unmount();
	});

	test("a deleted message opens no prompt at all", async () => {
		// The store refuses a reaction on a row that is gone, so the key must not offer one.
		// Asserted straight after `x`, before anything is typed or sent: a prompt that opens
		// and then refuses on Enter would pass a later assertion while still being wrong.
		const store = await seededStore(true);
		const { session, reactions } = fakeSession();
		const { stdin, lastFrame, unmount } = render(<Root store={store} session={session} />);
		await tick();

		await openPrompt(stdin);

		expect(plain(lastFrame() ?? "")).not.toContain("react ›");
		expect(reactions).toEqual([]);
		unmount();
	});

	test("an emoji confirmed without a pause still reaches the session", async () => {
		// Two keystrokes in one tick. The dispatch used to read the prompt from a ref that
		// `setState` had not refreshed yet, so the send path saw an empty draft and refused
		// with "not one emoji" while the emoji sat visibly in the prompt.
		const store = await seededStore();
		const { session, reactions } = fakeSession();
		const { stdin, unmount } = render(<Root store={store} session={session} />);
		await tick();

		stdin.write("\t");
		await tick();
		stdin.write("x");
		await tick();
		stdin.write("👍");
		stdin.write("\r");
		await tick(300);

		expect(reactions).toEqual([
			{
				conversationId: CONVERSATION,
				target: { sentAt: 1_760_000_000_000, authorId: "uuid-alice" },
				emoji: "👍",
				isRemove: false,
			},
		]);
		unmount();
	});

	test("x then enter sends the picker's first suggestion", async () => {
		// The whole point of the picker: a terminal cannot insert an emoji, so the prompt has
		// to offer one. No typing, no name, no picker-less dead end.
		const store = await seededStore();
		const { session, reactions } = fakeSession();
		const { stdin, lastFrame, unmount } = render(<Root store={store} session={session} />);
		await tick();

		await openPrompt(stdin);
		expect(plain(lastFrame() ?? "")).toContain("👍");

		stdin.write("\r");
		await tick(300);

		expect(reactions[0]?.emoji).toBe("👍");
		unmount();
	});

	test("tab walks the suggestions", async () => {
		const store = await seededStore();
		const { session, reactions } = fakeSession();
		const { stdin, unmount } = render(<Root store={store} session={session} />);
		await tick();

		await openPrompt(stdin);
		stdin.write("\t");
		await tick();
		stdin.write("\r");
		await tick(300);

		expect(reactions[0]?.emoji).toBe("❤️");
		unmount();
	});

	test("a name typed instead of an emoji is resolved", async () => {
		// Reported from the real TUI: typing `redheart` answered "not one emoji: 8 characters".
		// True, and useless — a picker that cannot be typed into is a picker nobody uses.
		const store = await seededStore();
		const { session, reactions } = fakeSession();
		const { stdin, unmount } = render(<Root store={store} session={session} />);
		await tick();

		await openPrompt(stdin);
		for (const char of "redheart") {
			stdin.write(char);
			await tick(20);
		}
		stdin.write("\r");
		await tick(300);

		expect(reactions[0]?.emoji).toBe("❤️");
		unmount();
	});

	test("a name that matches nothing still refuses, and names what was typed", async () => {
		const store = await seededStore();
		const { session, reactions } = fakeSession();
		const { stdin, lastFrame, unmount } = render(<Root store={store} session={session} />);
		await tick();

		await openPrompt(stdin);
		for (const char of "qqq") {
			stdin.write(char);
			await tick(20);
		}
		stdin.write("\r");
		await tick(300);

		expect(reactions).toEqual([]);
		// "zzz" is an alias of 😴, so a genuinely unmatched string is needed here.
		expect(plain(lastFrame() ?? "")).toContain("U+0071");
		unmount();
	});
});
