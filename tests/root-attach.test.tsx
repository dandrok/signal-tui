import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { render } from "ink-testing-library";
import { InMemoryStore } from "../src/adapters/memory/store";
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
	readonly file: SentFile | undefined;
}

const fakeSession = (): { session: Session; sent: Send[] } => {
	const sent: Send[] = [];
	return {
		sent,
		session: {
			start: async () => undefined,
			stop: async () => undefined,
			send: async (conversationId, body, _replyTo, file) => {
				sent.push({ conversationId, body, file });
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
});
