import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { render } from "ink-testing-library";
import { InMemoryStore } from "../src/adapters/memory/store";
import type { ReplyTargetIn } from "../src/app/reply";
import type { SentFile, Session } from "../src/app/session";
import { nodeOpenFs, type OpenContext } from "../src/app/usecases/open";
import type { Attachment, Message } from "../src/domain/types";
import { Root } from "../src/ui/Root";
import { plain } from "./helpers/frame";
import { waitFor } from "./helpers/wait";

/**
 * `o`, through the real `Root`: the first press asks, the answer launches the desktop's viewer,
 * and every press after that in the same run opens without asking again.
 *
 * The directory is made for the test and handed to `Root` as its open context, with a launcher
 * that only records: nothing here starts a viewer, and nothing depends on where the suite runs.
 * That matters more than usual — this is the one command in the client that runs something
 * outside the terminal, so its tests are the only proof of what it is allowed to run.
 */

const CONVERSATION = "uuid-amber";
const SENT_AT = 1_760_000_000_000;

const fakeSession = (): Session => ({
	start: async () => undefined,
	stop: async () => undefined,
	send: async (
		_id: string,
		_body: string,
		_replyTo: ReplyTargetIn | undefined,
		_file: SentFile | undefined,
	) => undefined,
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
});

const file = (path: string | null): Attachment => ({
	id: "file-1",
	contentType: "image/jpeg",
	filename: path,
	size: 120,
	caption: null,
	isVoiceNote: false,
});

const messageWith = (attachments: readonly Attachment[]): Message => ({
	id: `${CONVERSATION}:${SENT_AT}`,
	conversationId: CONVERSATION,
	author: "Amber",
	authorId: "uuid-amber",
	body: "look",
	sentAt: SENT_AT,
	isOutgoing: false,
	isDeleted: false,
	attachments,
});

/** A real attachments directory with one real file, and a store holding one row about it. */
const workspace = async (
	attachments: (root: string) => readonly Attachment[],
): Promise<{ root: string; store: InMemoryStore; launched: string[] }> => {
	const root = join(mkdtempSync(join(tmpdir(), "signal-tui-open-")), "signal-cli", "attachments");
	mkdirSync(root, { recursive: true });
	writeFileSync(join(root, "photo.jpg"), "x".repeat(120));
	const store = new InMemoryStore({ seed: false });
	await store.upsertConversation({
		id: CONVERSATION,
		name: "Amber",
		unreadCount: 0,
		lastActivityAt: SENT_AT,
	});
	await store.saveMessage(messageWith(attachments(root)));
	return { root, store, launched: [] };
};

const context = (root: string, launched: string[]): OpenContext => ({
	root,
	fs: nodeOpenFs,
	launch: (path) => {
		launched.push(path);
	},
});

type Frame = () => string | undefined;

const text = (lastFrame: Frame): string => plain(lastFrame() ?? "");

const press = async (
	stdin: { write: (input: string) => void },
	input: string,
	lastFrame: Frame,
	expected?: string,
): Promise<void> => {
	stdin.write(input);
	if (expected !== undefined) {
		await waitFor(
			() => text(lastFrame).includes(expected),
			`“${expected}” after ${JSON.stringify(input)}`,
		);
	}
};

describe("opening a received file", () => {
	test("the first `o` asks, ⏎ opens, and the next `o` does not ask again", async () => {
		const { root, store, launched } = await workspace((dir) => [file(join(dir, "photo.jpg"))]);
		const { stdin, lastFrame, unmount } = render(
			<Root store={store} session={fakeSession()} open={context(root, launched)} />,
		);

		await waitFor(() => text(lastFrame).includes("look"), "the thread to load");
		await press(stdin, "\t", lastFrame, "o open");
		await press(stdin, "o", lastFrame, "open ›");
		// The question, before anything has been launched.
		expect(text(lastFrame)).toContain("the file on that row?");
		expect(launched).toEqual([]);

		await press(stdin, "\r", lastFrame, "opened photo.jpg");
		expect(launched).toEqual([join(root, "photo.jpg")]);
		await waitFor(() => !text(lastFrame).includes("open ›"), "the prompt to close");

		// Consent is remembered for the run: the second press opens without a question.
		await press(stdin, "o", lastFrame);
		await waitFor(() => launched.length === 2, "the second launch");
		expect(text(lastFrame)).not.toContain("open ›");
		unmount();
	});

	test("escape keeps the file shut, and leaves the key working", async () => {
		const { root, store, launched } = await workspace((dir) => [file(join(dir, "photo.jpg"))]);
		const { stdin, lastFrame, unmount } = render(
			<Root store={store} session={fakeSession()} open={context(root, launched)} />,
		);

		await waitFor(() => text(lastFrame).includes("look"), "the thread to load");
		await press(stdin, "\t", lastFrame, "o open");
		await press(stdin, "o", lastFrame, "open ›");
		await press(stdin, "\u001b", lastFrame);
		await waitFor(() => !text(lastFrame).includes("open ›"), "the prompt to close");

		expect(launched).toEqual([]);
		// Nothing was granted, so the next `o` asks again rather than opening.
		await press(stdin, "o", lastFrame, "open ›");
		expect(launched).toEqual([]);
		unmount();
	});

	test("`n` answers the question with no", async () => {
		const { root, store, launched } = await workspace((dir) => [file(join(dir, "photo.jpg"))]);
		const { stdin, lastFrame, unmount } = render(
			<Root store={store} session={fakeSession()} open={context(root, launched)} />,
		);

		await waitFor(() => text(lastFrame).includes("look"), "the thread to load");
		await press(stdin, "\t", lastFrame, "o open");
		await press(stdin, "o", lastFrame, "open ›");
		await press(stdin, "n", lastFrame);
		await waitFor(() => !text(lastFrame).includes("open ›"), "the prompt to close");

		expect(launched).toEqual([]);
		unmount();
	});

	test("a file outside the engine's directory is refused by name, and never asked about", async () => {
		const { root, store, launched } = await workspace(() => [file("/home/you/.bashrc")]);
		const { stdin, lastFrame, unmount } = render(
			<Root store={store} session={fakeSession()} open={context(root, launched)} />,
		);

		await waitFor(() => text(lastFrame).includes("look"), "the thread to load");
		// The row is not advertised either: `o` would refuse it.
		await press(stdin, "\t", lastFrame, "a attach");
		expect(text(lastFrame)).not.toContain("o open");

		await press(stdin, "o", lastFrame, "is outside the engine's attachments folder");
		expect(text(lastFrame)).not.toContain("open ›");
		expect(launched).toEqual([]);
		unmount();
	});

	test("a row whose file was never downloaded says so instead of asking", async () => {
		const { root, store, launched } = await workspace(() => [file(null)]);
		const { stdin, lastFrame, unmount } = render(
			<Root store={store} session={fakeSession()} open={context(root, launched)} />,
		);

		await waitFor(() => text(lastFrame).includes("look"), "the thread to load");
		await press(stdin, "	", lastFrame, "a attach");
		await press(stdin, "o", lastFrame, "was not downloaded");
		expect(text(lastFrame)).not.toContain("open ›");
		expect(launched).toEqual([]);
		unmount();
	});

	test("a launcher that fails is reported, and consent is not granted", async () => {
		const { root, store } = await workspace((dir) => [file(join(dir, "photo.jpg"))]);
		const failing: OpenContext = {
			root,
			fs: nodeOpenFs,
			launch: () => {
				throw new Error("xdg-open is not on PATH");
			},
		};
		const { stdin, lastFrame, unmount } = render(
			<Root store={store} session={fakeSession()} open={failing} />,
		);

		await waitFor(() => text(lastFrame).includes("look"), "the thread to load");
		await press(stdin, "\t", lastFrame, "o open");
		await press(stdin, "o", lastFrame, "open ›");
		await press(stdin, "\r", lastFrame, "open failed: xdg-open is not on PATH");

		// Still asking: a machine that cannot open files should keep saying so.
		await press(stdin, "o", lastFrame, "open ›");
		unmount();
	});
});
