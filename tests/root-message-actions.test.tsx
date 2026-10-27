import { describe, expect, test } from "bun:test";
import { render } from "ink-testing-library";
import { InMemoryStore } from "../src/adapters/memory/store";
import type { Session } from "../src/app/session";
import type { MessageRef } from "../src/domain/message-ref";
import type { Message } from "../src/domain/types";
import { SELF_AUTHOR_ID } from "../src/domain/types";
import { Root } from "../src/ui/Root";
import { plain } from "./helpers/frame";

/**
 * Edit, delete-for-everyone and hide, through the real `Root`: the key opens the right prompt,
 * the prompt sends the right request, and a message that is not ours offers none at all.
 *
 * This is the test that catches the failure mode of this project's earlier slice — a feature
 * that exists in every layer and is wired in none — because it only ever touches a key.
 */

const tick = (ms = 120): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const CONVERSATION = "4b1c9f1e-0000-4000-8000-000000000000";
const SENT_AT = 1_760_000_000_000;

interface Calls {
	edits: Array<{ conversationId: string; target: MessageRef; body: string }>;
	removals: Array<{ conversationId: string; target: MessageRef }>;
	hides: Array<{ conversationId: string; messageId: string }>;
}

const fakeSession = (): { session: Session; calls: Calls } => {
	const calls: Calls = { edits: [], removals: [], hides: [] };
	return {
		calls,
		session: {
			start: async () => undefined,
			stop: async () => undefined,
			send: async () => undefined,
			markRead: async () => undefined,
			react: async () => undefined,
			edit: async (conversationId, target, body) => {
				calls.edits.push({ conversationId, target, body });
			},
			remove: async (conversationId, target) => {
				calls.removals.push({ conversationId, target });
			},
			hide: async (conversationId, messageId) => {
				calls.hides.push({ conversationId, messageId });
			},
			flush: async () => undefined,
			onChange: () => () => undefined,
			onIncoming: () => () => undefined,
			errors: [],
		},
	};
};

/** A store holding one of our own messages, unless `mine` is false. */
const seeded = async (mine: boolean): Promise<InMemoryStore> => {
	const store = new InMemoryStore({ seed: false });
	await store.upsertConversation({
		id: CONVERSATION,
		name: "Amber",
		unreadCount: 0,
		lastActivityAt: SENT_AT,
	});
	const message: Message = {
		id: `${CONVERSATION}:${SENT_AT}`,
		conversationId: CONVERSATION,
		author: mine ? "You" : "Amber",
		authorId: mine ? SELF_AUTHOR_ID : "uuid-amber",
		body: "dinner at 7?",
		sentAt: SENT_AT,
		isOutgoing: mine,
		isDeleted: false,
		attachments: [],
	};
	await store.saveMessage(message);
	return store;
};

/** Tab to the message pane, then the key that opens the prompt. */
const openPrompt = async (
	stdin: { write: (input: string) => void },
	key: string,
): Promise<void> => {
	stdin.write("\t");
	await tick();
	stdin.write(key);
	await tick();
};

describe("editing from the keyboard", () => {
	test("e opens a prompt seeded with the body, and enter saves it", async () => {
		const store = await seeded(true);
		const { session, calls } = fakeSession();
		const { stdin, lastFrame, unmount } = render(<Root store={store} session={session} />);
		await tick();

		await openPrompt(stdin, "e");
		// Seeded, not empty: editing means changing what is there.
		expect(plain(lastFrame() ?? "")).toContain("edit › dinner at 7?");

		for (const char of "!") {
			stdin.write(char);
			await tick();
		}
		stdin.write("\r");
		await tick();

		expect(calls.edits).toEqual([
			{
				conversationId: CONVERSATION,
				target: { sentAt: SENT_AT, authorId: SELF_AUTHOR_ID },
				body: "dinner at 7?!",
			},
		]);
		expect(plain(lastFrame() ?? "")).not.toContain("edit ›");
		unmount();
	});

	test("escape leaves the message alone", async () => {
		const store = await seeded(true);
		const { session, calls } = fakeSession();
		const { stdin, lastFrame, unmount } = render(<Root store={store} session={session} />);
		await tick();

		await openPrompt(stdin, "e");
		stdin.write("");
		stdin.write("\u001b");
		await tick();

		expect(calls.edits).toEqual([]);
		expect(plain(lastFrame() ?? "")).not.toContain("edit ›");
		unmount();
	});

	test("someone else's message opens no edit prompt, says why, and is not advertised", async () => {
		// The rule is refused before a prompt exists, so the user never types a correction the
		// use case would drop. The status line also stops offering the key on that message.
		const store = await seeded(false);
		const { session } = fakeSession();
		const { stdin, lastFrame, unmount } = render(<Root store={store} session={session} />);
		await tick();

		const before = plain(lastFrame() ?? "");
		expect(before).not.toContain("e edit");
		expect(before).not.toContain("d delete");

		await openPrompt(stdin, "e");

		const after = plain(lastFrame() ?? "");
		expect(after).not.toContain("edit ›");
		expect(after).toContain("only your own message can be edited");
		unmount();
	});
});

describe("deleting from the keyboard", () => {
	test("d asks first, and y deletes for everyone", async () => {
		const store = await seeded(true);
		const { session, calls } = fakeSession();
		const { stdin, lastFrame, unmount } = render(<Root store={store} session={session} />);
		await tick();

		await openPrompt(stdin, "d");
		expect(plain(lastFrame() ?? "")).toContain("delete ›");

		stdin.write("y");
		await tick();

		expect(calls.removals).toEqual([
			{ conversationId: CONVERSATION, target: { sentAt: SENT_AT, authorId: SELF_AUTHOR_ID } },
		]);
		unmount();
	});

	test("n leaves it alone", async () => {
		const store = await seeded(true);
		const { session, calls } = fakeSession();
		const { stdin, unmount } = render(<Root store={store} session={session} />);
		await tick();

		await openPrompt(stdin, "d");
		stdin.write("n");
		await tick();

		expect(calls.removals).toEqual([]);
		unmount();
	});

	test("someone else's message opens no delete prompt", async () => {
		const store = await seeded(false);
		const { session, calls } = fakeSession();
		const { stdin, lastFrame, unmount } = render(<Root store={store} session={session} />);
		await tick();

		await openPrompt(stdin, "d");

		const frame = plain(lastFrame() ?? "");
		expect(frame).not.toContain("delete ›");
		expect(frame).toContain("only your own message can be deleted for everyone");
		expect(calls.removals).toEqual([]);
		unmount();
	});
});

describe("hiding from the keyboard", () => {
	test("D hides without asking, because it changes nothing for anyone else", async () => {
		const store = await seeded(false);
		const { session, calls } = fakeSession();
		const { stdin, lastFrame, unmount } = render(<Root store={store} session={session} />);
		await tick();

		await openPrompt(stdin, "D");

		expect(calls.hides).toEqual([
			{ conversationId: CONVERSATION, messageId: `${CONVERSATION}:${SENT_AT}` },
		]);
		// No prompt: nothing to confirm, and nothing left to draw once the store answers.
		expect(plain(lastFrame() ?? "")).not.toContain("delete ›");
		unmount();
	});
});
