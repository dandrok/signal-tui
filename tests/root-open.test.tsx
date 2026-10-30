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
 * `o`, through the real `Root`: the first press offers the row's files, the answer launches one,
 * and a one-file row opens straight away on every press after that.
 *
 * The directory is made for the test and handed to `Root` as its open context, with a launcher
 * that only records: nothing here starts a viewer, and nothing depends on where the suite runs.
 * That matters more than usual — this is the one command in the client that runs something
 * outside the terminal, so its tests are the only proof of what it is allowed to run.
 *
 * The rows are modelled the way a real cache writes one: the file on disk is named after the
 * attachment id, and `filename` is the name the sender gave it — the pair that made the first cut
 * refuse every live attachment.
 */

const CONVERSATION = "uuid-amber";
const SENT_AT = 1_760_000_000_000;
/** What signal-cli writes into its attachments directory. */
const LOCAL = "abc123XYZ-photo.jpg";
/** What the sender called it, which is what the pane draws. */
const DISPLAY = "signal-2026-10-24-203528.jpeg";

const fakeSession = (): Session => ({
	start: async () => undefined,
	startDirect: async () => undefined,
	listContacts: async () => [],
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

const file = (over: Partial<Attachment> = {}): Attachment => ({
	id: LOCAL,
	contentType: "image/jpeg",
	filename: DISPLAY,
	size: 120,
	caption: null,
	isVoiceNote: false,
	...over,
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

/** Four files on one row, each with its own id on disk and its own display name. */
const FOUR = [
	{ id: "aaa111-one.jpg", filename: "signal-2026-10-24-203528.jpeg" },
	{ id: "bbb222-two.jpg", filename: "signal-2026-10-24-203530.jpeg" },
	{ id: "ccc333-three.jpg", filename: "signal-2026-10-24-203531.jpeg" },
	{ id: "ddd444-four.pdf", filename: "invoice.pdf" },
];

/** A real attachments directory with the row's files in it, and a store holding that row. */
const workspace = async (
	attachments: readonly Attachment[],
	/** Ids to actually write to disk; every id by default, so a test can claim a file is gone. */
	written: readonly string[] = attachments.flatMap((entry) =>
		typeof entry.id === "string" ? [entry.id] : [],
	),
): Promise<{ root: string; store: InMemoryStore; launched: string[] }> => {
	const root = join(mkdtempSync(join(tmpdir(), "signal-tui-open-")), "signal-cli", "attachments");
	mkdirSync(root, { recursive: true });
	for (const id of written) {
		writeFileSync(join(root, id), "x".repeat(120));
	}
	const store = new InMemoryStore({ seed: false });
	await store.upsertConversation({
		id: CONVERSATION,
		name: "Amber",
		unreadCount: 0,
		lastActivityAt: SENT_AT,
	});
	await store.saveMessage(messageWith(attachments));
	return { root, store, launched: [] };
};

const context = (root: string, launched: string[]): OpenContext => ({
	root,
	fs: nodeOpenFs,
	launch: async (path) => {
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
	test("the first `o` asks, ⏎ opens the file on disk, and the next `o` does not ask again", async () => {
		const { root, store, launched } = await workspace([file()]);
		const { stdin, lastFrame, unmount } = render(
			<Root store={store} session={fakeSession()} open={context(root, launched)} />,
		);

		await waitFor(() => text(lastFrame).includes("look"), "the thread to load");
		await press(stdin, "\t", lastFrame, "o open");
		await press(stdin, "o", lastFrame, "open ›");
		// The question is the file itself, named and counted, before anything has been launched.
		expect(text(lastFrame)).toContain("1/1");
		expect(launched).toEqual([]);

		// The notice names the file the way the row does, not the id it is stored under.
		await press(stdin, "\r", lastFrame, `opened ${DISPLAY}`);
		expect(launched).toEqual([join(root, LOCAL)]);
		await waitFor(() => !text(lastFrame).includes("open ›"), "the prompt to close");

		// Consent is remembered for the run, and this row has one file: the second press opens it.
		await press(stdin, "o", lastFrame);
		await waitFor(() => launched.length === 2, "the second launch");
		expect(text(lastFrame)).not.toContain("open ›");
		unmount();
	});

	test("four files on one row: the picker lists all four and ⏎ opens the one it is on", async () => {
		const { root, store, launched } = await workspace(FOUR.map((entry) => file(entry)));
		const { stdin, lastFrame, unmount } = render(
			<Root store={store} session={fakeSession()} open={context(root, launched)} />,
		);

		await waitFor(() => text(lastFrame).includes("look"), "the thread to load");
		await press(stdin, "\t", lastFrame, "o open");
		await press(stdin, "o", lastFrame, "open ›");
		// The list is drawn with its position: a name is truncated at this width, the count is not.
		expect(text(lastFrame)).toContain("1/4");
		expect(text(lastFrame)).toContain("signal-2026-10-24-203");
		expect(launched).toEqual([]);

		// The arrows walk the list, and the position says where ⏎ goes.
		await press(stdin, "\u001b[B", lastFrame, "2/4");
		await press(stdin, "\u001b[B", lastFrame, "3/4");

		await press(stdin, "\r", lastFrame, `opened ${FOUR[2]?.filename}`);
		// The third file, at the id path — not the first, and not its display name.
		expect(launched).toEqual([join(root, FOUR[2]?.id ?? "")]);
		unmount();
	});

	test("a four-file row asks every time: the list is a choice, not a first-run question", async () => {
		const { root, store, launched } = await workspace(FOUR.map((entry) => file(entry)));
		const { stdin, lastFrame, unmount } = render(
			<Root store={store} session={fakeSession()} open={context(root, launched)} />,
		);

		await waitFor(() => text(lastFrame).includes("look"), "the thread to load");
		await press(stdin, "\t", lastFrame, "o open");
		await press(stdin, "o", lastFrame, "open ›");
		await press(stdin, "\r", lastFrame, `opened ${FOUR[0]?.filename}`);
		await waitFor(() => !text(lastFrame).includes("open ›"), "the prompt to close");

		// Consent was granted, but there are still four files to choose between.
		await press(stdin, "o", lastFrame, "1/4");
		await press(stdin, "\t", lastFrame, "2/4");
		await press(stdin, "\r", lastFrame, `opened ${FOUR[1]?.filename}`);

		expect(launched).toEqual([join(root, FOUR[0]?.id ?? ""), join(root, FOUR[1]?.id ?? "")]);
		unmount();
	});

	test("escape keeps the file shut, and leaves the key working", async () => {
		const { root, store, launched } = await workspace([file()]);
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

	test("a row the engine kept no copy of is refused by name, and never asked about", async () => {
		// Our own send, or a file downloaded by another client: an id of null, and a `filename`
		// that is a path this machine never wrote.
		const { root, store, launched } = await workspace([
			file({ id: null, filename: "/home/you/cv.pdf" }),
		]);
		const { stdin, lastFrame, unmount } = render(
			<Root store={store} session={fakeSession()} open={context(root, launched)} />,
		);

		await waitFor(() => text(lastFrame).includes("look"), "the thread to load");
		// The row is not advertised either: `o` would refuse it. The wait names a hint only the
		// message pane prints, so the assertion cannot run against the conversation list's frame.
		await press(stdin, "\t", lastFrame, "j/k select");
		expect(text(lastFrame)).not.toContain("o open");

		await press(stdin, "o", lastFrame, "the engine kept no copy of that file");
		expect(text(lastFrame)).not.toContain("open ›");
		expect(launched).toEqual([]);
		unmount();
	});

	test("a file that left the disk after the row was cached says so", async () => {
		// Nothing is written under that id: the row remembers a file the disk does not have.
		const { root, store, launched } = await workspace([file({ id: "gone.jpg" })], []);
		const { stdin, lastFrame, unmount } = render(
			<Root store={store} session={fakeSession()} open={context(root, launched)} />,
		);

		await waitFor(() => text(lastFrame).includes("look"), "the thread to load");
		await press(stdin, "\t", lastFrame, "j/k select");
		await press(stdin, "o", lastFrame, "no longer on disk");
		expect(launched).toEqual([]);
		unmount();
	});

	test("demo mode, which has no engine, still opens: a launch is not a message", async () => {
		const { root, store, launched } = await workspace([file()]);
		// No `session` prop at all, which is how `--demo` runs.
		const { stdin, lastFrame, unmount } = render(
			<Root store={store} open={context(root, launched)} />,
		);

		await waitFor(() => text(lastFrame).includes("look"), "the thread to load");
		await press(stdin, "\t", lastFrame, "j/k select");
		await press(stdin, "o", lastFrame, "open ›");
		await press(stdin, "\r", lastFrame, `opened ${DISPLAY}`);

		expect(launched).toEqual([join(root, LOCAL)]);
		unmount();
	});

	test("a launcher that fails is reported, and consent is not granted", async () => {
		const { root, store } = await workspace([file()]);
		const failing: OpenContext = {
			root,
			fs: nodeOpenFs,
			launch: async () => {
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
