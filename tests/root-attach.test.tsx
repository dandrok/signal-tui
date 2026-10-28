import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { render } from "ink-testing-library";
import { InMemoryStore } from "../src/adapters/memory/store";
import type { ReplyTargetIn } from "../src/app/reply";
import type { SentFile, Session } from "../src/app/session";
import { nodeAttachFs } from "../src/app/usecases/attach";
import type { Message } from "../src/domain/types";
import { Root } from "../src/ui/Root";
import { plain } from "./helpers/frame";
import { waitFor } from "./helpers/wait";

/**
 * Attaching a file, through the real `Root` and a real directory: `a` opens the path prompt on
 * the directory the client was started in, typing narrows it, `⏎` on a folder descends and `⏎`
 * on a file sends it — the conversation gets the file, the row says its name and size.
 *
 * The directory is made for the test and handed to `Root` as its attach context, so nothing here
 * depends on where the suite happens to run.
 */

const CONVERSATION = "uuid-amber";
const SENT_AT = 1_760_000_000_000;

interface Send {
	readonly conversationId: string;
	readonly body: string;
	readonly replyTo: ReplyTargetIn | undefined;
	readonly file: SentFile | undefined;
}

const fakeSession = (refuse = false): { session: Session; sent: Send[] } => {
	const sent: Send[] = [];
	return {
		sent,
		session: {
			start: async () => undefined,
			stop: async () => undefined,
			send: async (conversationId, body, replyTo, file) => {
				if (refuse) {
					throw new Error("engine is gone");
				}
				sent.push({ conversationId, body, replyTo, file });
			},
			markRead: async () => undefined,
			typingIn: () => null,
			react: async () => undefined,
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

const message: Message = {
	id: `${CONVERSATION}:${SENT_AT}`,
	conversationId: CONVERSATION,
	author: "Amber",
	authorId: "uuid-amber",
	body: "dinner at 7?",
	sentAt: SENT_AT,
	isOutgoing: false,
	isDeleted: false,
	attachments: [],
};

/** A directory with one folder, one file and a dotfile; the store holds one conversation. */
const workspace = async (): Promise<{ root: string; store: InMemoryStore }> => {
	const root = mkdtempSync(join(tmpdir(), "signal-tui-attach-"));
	writeFileSync(join(root, "cv.pdf"), "x".repeat(120));
	writeFileSync(join(root, ".hidden"), "y");
	mkdirSync(join(root, "photos"));
	writeFileSync(join(root, "photos", "cat.jpg"), "z".repeat(40));

	const store = new InMemoryStore({ seed: false });
	await store.upsertConversation({
		id: CONVERSATION,
		name: "Amber",
		unreadCount: 0,
		lastActivityAt: SENT_AT,
	});
	await store.saveMessage(message);
	return { root, store };
};

type Frame = () => string | undefined;

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

/** How many times `needle` appears in the frame: a quoted row repeats the thread's words. */
const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

describe("attaching a file from the keyboard", () => {
	test("a lists the folder the client was started in, and enter sends the picked file", async () => {
		const { root, store } = await workspace();
		const { session, sent } = fakeSession();
		const { stdin, lastFrame, unmount } = render(
			<Root
				store={store}
				session={session}
				attachments={{ cwd: root, home: root, fs: nodeAttachFs }}
			/>,
		);

		await waitFor(() => frameText(lastFrame).includes("dinner at 7?"), "the thread to load");
		await press(stdin, "\t", lastFrame, "a attach");
		await press(stdin, "a", lastFrame, "attach ›");
		// The folder comes first, the dotfile never at all.
		await waitFor(() => frameText(lastFrame).includes("photos/"), "the listing");
		expect(frameText(lastFrame)).not.toContain(".hidden");

		await press(stdin, "cv", lastFrame, "cv.pdf");
		await press(stdin, "\r", lastFrame, "sent cv.pdf");

		expect(sent).toEqual([
			{
				conversationId: CONVERSATION,
				body: "",
				replyTo: undefined,
				file: { path: join(root, "cv.pdf"), name: "cv.pdf", size: 120 },
			},
		]);
		unmount();
	});

	test("enter on a folder descends into it instead of sending it", async () => {
		const { root, store } = await workspace();
		const { session, sent } = fakeSession();
		const { stdin, lastFrame, unmount } = render(
			<Root
				store={store}
				session={session}
				attachments={{ cwd: root, home: root, fs: nodeAttachFs }}
			/>,
		);

		await waitFor(() => frameText(lastFrame).includes("dinner at 7?"), "the thread to load");
		await press(stdin, "\t", lastFrame, "a attach");
		await press(stdin, "a", lastFrame, "attach ›");
		await waitFor(() => frameText(lastFrame).includes("photos/"), "the listing");
		await press(stdin, "\r", lastFrame, "cat.jpg");
		// Nothing was sent by the descent: a folder is a step.
		expect(sent).toEqual([]);

		await press(stdin, "\r", lastFrame, "sent cat.jpg");
		expect(sent).toEqual([
			{
				conversationId: CONVERSATION,
				body: "",
				replyTo: undefined,
				file: { path: join(root, "photos", "cat.jpg"), name: "cat.jpg", size: 40 },
			},
		]);
		unmount();
	});

	test("escape sends nothing at all", async () => {
		const { root, store } = await workspace();
		const { session, sent } = fakeSession();
		const { stdin, lastFrame, unmount } = render(
			<Root
				store={store}
				session={session}
				attachments={{ cwd: root, home: root, fs: nodeAttachFs }}
			/>,
		);

		await waitFor(() => frameText(lastFrame).includes("dinner at 7?"), "the thread to load");
		await press(stdin, "\t", lastFrame, "a attach");
		await press(stdin, "a", lastFrame, "attach ›");
		await press(stdin, "\u001b", lastFrame);

		expect(sent).toEqual([]);
		await waitFor(() => !frameText(lastFrame).includes("attach ›"), "the prompt to close");
		unmount();
	});

	test("a path that does not exist is refused by name, and nothing goes out", async () => {
		const { root, store } = await workspace();
		const { session, sent } = fakeSession();
		const { stdin, lastFrame, unmount } = render(
			<Root
				store={store}
				session={session}
				attachments={{ cwd: root, home: root, fs: nodeAttachFs }}
			/>,
		);

		await waitFor(() => frameText(lastFrame).includes("dinner at 7?"), "the thread to load");
		await press(stdin, "\t", lastFrame, "a attach");
		await press(stdin, "a", lastFrame, "attach ›");
		await press(stdin, "nope.txt", lastFrame, "no file matches");
		await press(stdin, "\r", lastFrame, "nothing at");

		expect(sent).toEqual([]);
		unmount();
	});
	test("the words already in the composer travel with the file", async () => {
		// "here's the CV", then `a`: the sentence is the message the file belongs to. Sending the
		// file alone and leaving the draft in the box was the first cut of this, and it read as
		// a bug the moment anyone tried it.
		const { root, store } = await workspace();
		const { session, sent } = fakeSession();
		const { stdin, lastFrame, unmount } = render(
			<Root
				store={store}
				session={session}
				attachments={{ cwd: root, home: root, fs: nodeAttachFs }}
			/>,
		);

		await waitFor(() => frameText(lastFrame).includes("dinner at 7?"), "the thread to load");
		await press(stdin, "\t", lastFrame, "a attach");
		await press(stdin, "i", lastFrame);
		await press(stdin, "here is the CV", lastFrame);
		// Back to the thread, and *waited for*: two keys in one tick are both read against the
		// state before either landed, so `a` would be typed into the composer it just left.
		await press(stdin, "\u001b", lastFrame, "a attach");
		await press(stdin, "a", lastFrame, "attach ›");
		await press(stdin, "cv", lastFrame, "cv.pdf");
		await press(stdin, "\r", lastFrame, "sent cv.pdf");

		expect(sent).toEqual([
			{
				conversationId: CONVERSATION,
				body: "here is the CV",
				replyTo: undefined,
				file: { path: join(root, "cv.pdf"), name: "cv.pdf", size: 120 },
			},
		]);
		unmount();
	});

	test("a reply in progress is answered by the file, quote and all", async () => {
		// The quote and the file are not alternatives: `⏎` on a draft answers the pointed row,
		// and so does a file. Dropping the target silently would send the file dangling.
		const { root, store } = await workspace();
		const { session, sent } = fakeSession();
		const { stdin, lastFrame, unmount } = render(
			<Root
				store={store}
				session={session}
				attachments={{ cwd: root, home: root, fs: nodeAttachFs }}
			/>,
		);

		await waitFor(() => frameText(lastFrame).includes("dinner at 7?"), "the thread to load");
		await press(stdin, "\t", lastFrame, "r reply");
		await press(stdin, "r", lastFrame);
		await waitFor(
			() => count(frameText(lastFrame), "dinner at 7?") >= 2,
			"the quoted target in the composer",
		);
		// Out of the composer without dropping the reply: the box keeps its target while the
		// list has the keyboard.
		await press(stdin, "\t", lastFrame, "j/k move");
		await press(stdin, "a", lastFrame, "attach ›");
		await press(stdin, "cv", lastFrame, "cv.pdf");
		await press(stdin, "\r", lastFrame, "sent cv.pdf");

		expect(sent).toEqual([
			{
				conversationId: CONVERSATION,
				body: "",
				replyTo: { sentAt: SENT_AT, authorId: "uuid-amber", text: "dinner at 7?" },
				file: { path: join(root, "cv.pdf"), name: "cv.pdf", size: 120 },
			},
		]);
		unmount();
	});
	test("a refused send gives the sentence back", async () => {
		// The box was emptied optimistically, the way `⏎` empties it. If the engine refuses the
		// file, that optimism has to be undone: retyping a sentence you already wrote is the
		// worst thing a failed send can cost you.
		const { root, store } = await workspace();
		const { session, sent } = fakeSession(true);
		const { stdin, lastFrame, unmount } = render(
			<Root
				store={store}
				session={session}
				attachments={{ cwd: root, home: root, fs: nodeAttachFs }}
			/>,
		);

		await waitFor(() => frameText(lastFrame).includes("dinner at 7?"), "the thread to load");
		await press(stdin, "\t", lastFrame, "a attach");
		await press(stdin, "i", lastFrame);
		await press(stdin, "here is the CV", lastFrame);
		await press(stdin, "\u001b", lastFrame, "a attach");
		await press(stdin, "a", lastFrame, "attach ›");
		await press(stdin, "cv", lastFrame, "cv.pdf");
		await press(stdin, "\r", lastFrame, "attach failed");

		expect(sent).toEqual([]);
		// Back in the composer, not in the thread: the message never went.
		expect(frameText(lastFrame)).toContain("here is the CV");
		unmount();
	});
});
