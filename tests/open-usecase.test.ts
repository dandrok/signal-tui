import { describe, expect, test } from "bun:test";
import {
	canOpen,
	engineAttachmentsRoot,
	inAttachmentsDir,
	type OpenContext,
	type OpenFs,
	openPlan,
} from "../src/app/usecases/open";
import type { Attachment, Message } from "../src/domain/types";

/**
 * Opening a file someone sent, as a verdict: which path a row would hand to the desktop, and
 * the sentence that says why it is not going to.
 *
 * The rule being pinned is the one that leaves the terminal: **only the engine's own directory**.
 * Every test below is a way in that has to be closed — a relative name, a path a peer chose, a
 * `..` that starts with the root and ends outside it, a symlink that resolves out of it — because
 * a terminal that launches whatever a message names is remote code execution with a keybinding.
 */

const ROOT = "/home/you/.local/share/signal-cli/attachments";
const CONVERSATION = "uuid-amber";
const SENT_AT = 1_760_000_000_000;
const DOWNLOADED = `${ROOT}/abc123-photo.jpg`;

/** Files that exist, keyed by their canonical path; anything else is gone. */
interface FakeFs extends OpenFs {
	readonly files: Set<string>;
	readonly links: Map<string, string>;
}

const fakeFs = (files: readonly string[], links: Readonly<Record<string, string>> = {}): FakeFs => {
	const set = new Set(files);
	const map = new Map(Object.entries(links));
	return {
		files: set,
		links: map,
		realPath: (path) => {
			const linked = map.get(path);
			return linked ?? (set.has(path) ? path : null);
		},
		isFile: (path) => set.has(path),
	};
};

const context = (fs: OpenFs = fakeFs([DOWNLOADED])): OpenContext => ({
	root: ROOT,
	fs,
	launch: () => undefined,
});

const attachment = (filename: string | null, over: Partial<Attachment> = {}): Attachment => ({
	id: "file-1",
	contentType: "image/jpeg",
	filename,
	size: 120,
	caption: null,
	isVoiceNote: false,
	...over,
});

const message = (
	over: Partial<Message> = {},
	files: readonly Attachment[] = [attachment(DOWNLOADED)],
): Message => ({
	id: `${CONVERSATION}:${SENT_AT}`,
	conversationId: CONVERSATION,
	author: "Amber",
	authorId: "uuid-amber",
	body: "",
	sentAt: SENT_AT,
	isOutgoing: false,
	isDeleted: false,
	attachments: files,
	...over,
});

const refusal = (target: Message | undefined, ctx = context()): string | null => {
	const plan = openPlan(target, CONVERSATION, ctx);
	return plan.kind === "refused" ? plan.reason : null;
};

describe("the engine's attachments directory", () => {
	test("is read from XDG_DATA_HOME when it is absolute", () => {
		expect(engineAttachmentsRoot({ XDG_DATA_HOME: "/data" }, "/home/you")).toBe(
			"/data/signal-cli/attachments",
		);
	});

	test("falls back to ~/.local/share when XDG_DATA_HOME is relative, as the engine does", () => {
		expect(engineAttachmentsRoot({ XDG_DATA_HOME: "data" }, "/home/you")).toBe(
			"/home/you/.local/share/signal-cli/attachments",
		);
		expect(engineAttachmentsRoot({}, "/home/you")).toBe(
			"/home/you/.local/share/signal-cli/attachments",
		);
	});

	test("counts a path below it and not the root itself", () => {
		expect(inAttachmentsDir(`${ROOT}/file.jpg`, ROOT)).toBe(true);
		expect(inAttachmentsDir(`${ROOT}/nested/file.jpg`, ROOT)).toBe(true);
		expect(inAttachmentsDir(ROOT, ROOT)).toBe(false);
	});

	test("refuses a sibling whose name starts with the same letters", () => {
		// The bug a `startsWith(root)` without the separator would have: a directory next door
		// whose name begins with `attachments`.
		expect(inAttachmentsDir(`${ROOT}-evil/file.jpg`, ROOT)).toBe(false);
	});

	test("refuses a traversal that starts inside and ends outside", () => {
		expect(inAttachmentsDir(`${ROOT}/../../.ssh/id_ed25519`, ROOT)).toBe(false);
	});

	test("refuses a path that is not absolute", () => {
		expect(inAttachmentsDir("photo.jpg", ROOT)).toBe(false);
		expect(inAttachmentsDir("./photo.jpg", ROOT)).toBe(false);
	});
});

describe("what `o` does on a row", () => {
	test("opens the file the engine downloaded", () => {
		const plan = openPlan(message(), CONVERSATION, context());

		expect(plan).toEqual({
			kind: "open",
			file: { path: DOWNLOADED, name: "abc123-photo.jpg" },
		});
	});

	test("refuses a message that is gone", () => {
		expect(refusal(undefined)).toBe("that message is gone: nothing to open");
	});

	test("refuses a row from another conversation", () => {
		expect(openPlan(message({ conversationId: "uuid-other" }), CONVERSATION, context())).toEqual({
			kind: "refused",
			reason: "that message is not in this conversation",
		});
	});

	test("says the message was deleted rather than that the file is missing", () => {
		expect(refusal(message({ isDeleted: true }))).toBe("that message was deleted: nothing to open");
	});

	test("refuses an expired row: the purge took the file with it", () => {
		expect(refusal(message({ isExpired: true }))).toBe("that message expired: its file is gone");
	});

	test("refuses a view-once row: nothing of it was ever stored", () => {
		expect(refusal(message({ isViewOnce: true }))).toBe(
			"a view-once file was never stored: nothing to open",
		);
	});

	test("refuses a row with no files, and one whose file was never downloaded", () => {
		expect(refusal(message({}, []))).toBe("that message has no file");
		// `ignoreAttachments`: the engine reports the file it did not keep, and its name is null.
		expect(refusal(message({}, [attachment(null)]))).toBe(
			"that file was not downloaded, so there is nothing to open",
		);
	});

	test("refuses a path a peer named, without ever touching the disk", () => {
		const fs = fakeFs(["/home/you/.bashrc"]);
		expect(refusal(message({}, [attachment("/home/you/.bashrc")]), context(fs))).toBe(
			".bashrc is outside the engine's attachments folder: not opening it",
		);
	});

	test("refuses a relative name, which is what a caption would supply", () => {
		expect(refusal(message({}, [attachment("photo.jpg")]))).toBe(
			"photo.jpg is outside the engine's attachments folder: not opening it",
		);
	});

	test("refuses a file that left the disk after the row was cached", () => {
		expect(refusal(message(), context(fakeFs([])))).toBe("abc123-photo.jpg is no longer on disk");
	});

	test("refuses a folder inside the directory", () => {
		const folder = `${ROOT}/a-folder`;
		const fs: OpenFs = {
			realPath: (path) => (path === folder ? folder : null),
			isFile: () => false,
		};
		expect(refusal(message({}, [attachment(folder)]), context(fs))).toBe(
			"a-folder is a folder, not a file",
		);
	});

	test("refuses a link inside the directory that resolves outside it", () => {
		// The text of the path is inside; the file it points at is not. The canonical path is what
		// gets checked, because it is what the opener will be handed.
		const link = `${ROOT}/looks-fine.jpg`;
		const fs = fakeFs(["/home/you/.bashrc"], { [link]: "/home/you/.bashrc" });
		expect(refusal(message({}, [attachment(link)]), context(fs))).toBe(
			"looks-fine.jpg points outside the engine's attachments folder: not opening it",
		);
	});

	test("follows a symlinked attachments directory, because the root is canonicalised too", () => {
		// `$XDG_DATA_HOME` on a machine whose data directory is a symlink: the file's real path is
		// outside the root's *text*, and still inside the root's *place*.
		const realRoot = "/srv/data/signal-cli/attachments";
		const file = `${realRoot}/abc123-photo.jpg`;
		const fs: OpenFs = {
			realPath: (path) => (path === ROOT ? realRoot : file),
			isFile: () => true,
		};

		expect(openPlan(message({}, [attachment(file)]), CONVERSATION, context(fs))).toEqual({
			kind: "open",
			file: { path: file, name: "abc123-photo.jpg" },
		});
	});

	test("takes the first file that has a path, not the first file", () => {
		const second = `${ROOT}/second.png`;
		const fs = fakeFs([DOWNLOADED, second]);
		const plan = openPlan(
			message({}, [attachment(null), attachment(DOWNLOADED)]),
			CONVERSATION,
			context(fs),
		);

		expect(plan).toEqual({ kind: "open", file: { path: DOWNLOADED, name: "abc123-photo.jpg" } });
	});

	test("opens our own row only when the engine kept the file there too", () => {
		// A reply we sent carries the path we picked, which is not the engine's directory: the rule
		// is about the directory, not about who wrote the message.
		expect(refusal(message({ isOutgoing: true }, [attachment("/home/you/cv.pdf")]))).toBe(
			"cv.pdf is outside the engine's attachments folder: not opening it",
		);
	});
});

describe("what the status line advertises", () => {
	test("names a file inside the directory and nothing else", () => {
		expect(canOpen(message(), ROOT)).toBe(true);
		expect(canOpen(message({}, [attachment(null)]), ROOT)).toBe(false);
		expect(canOpen(message({}, [attachment("/home/you/cv.pdf")]), ROOT)).toBe(false);
		expect(canOpen(message({}, []), ROOT)).toBe(false);
	});
});
