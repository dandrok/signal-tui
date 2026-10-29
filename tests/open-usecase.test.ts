import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import {
	canOpen,
	engineAttachmentsRoot,
	inAttachmentsDir,
	type OpenContext,
	type OpenFile,
	type OpenFs,
	openCandidates,
	openFiles,
	openPlan,
} from "../src/app/usecases/open";
import type { Attachment, Message } from "../src/domain/types";

/**
 * Opening a file someone sent, as a verdict: which paths a row offers, which one a keystroke
 * launches, and the sentence that says why there is none.
 *
 * Three rules are pinned here, and the first two were wrong in the first cut. The file on disk is
 * `<data-dir>/attachments/<id>` — the engine reports the original name as `filename`, which names
 * nothing — a row with four files offers all four rather than whichever came first, and **only
 * that directory is reachable**: every case below is a way in that has to be closed, because a
 * terminal that launches whatever a message names is remote code execution with a keybinding.
 */

const ROOT = "/home/you/.local/share/signal-cli/attachments";
const CONVERSATION = "uuid-amber";
const SENT_AT = 1_760_000_000_000;
/** What signal-cli actually writes: the attachment id, extension included. */
const LOCAL = "abc123-photo.jpg";
const DOWNLOADED = `${ROOT}/${LOCAL}`;

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

const context = (root: string = ROOT, fs: OpenFs = fakeFs([DOWNLOADED])): OpenContext => ({
	root,
	fs,
	launch: async () => undefined,
});

/** An attachment as the mapper reports it: an id the engine saved under, and a display name. */
const attachment = (id: string | null, over: Partial<Attachment> = {}): Attachment => ({
	id,
	contentType: "image/jpeg",
	filename: "photo.jpg",
	size: 120,
	caption: null,
	isVoiceNote: false,
	...over,
});

const message = (
	over: Partial<Message> = {},
	files: readonly Attachment[] = [attachment(LOCAL)],
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

const refusal = (target: Message, ctx = context()): string | null => {
	const listed = openFiles(target, CONVERSATION, ctx);
	return listed.kind === "refused" ? listed.reason : null;
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

	test("follows --config in engineArgs, which moves the whole data directory", () => {
		// The engine's downloads go where its data directory is, and `--config` is the one
		// setting that moves it. Reading past it would refuse the files of anyone who moved.
		expect(engineAttachmentsRoot({}, "/home/you", ["--config", "/mnt/data/signal"])).toBe(
			"/mnt/data/signal/attachments",
		);
		expect(engineAttachmentsRoot({}, "/home/you", ["--config=/mnt/data/signal"])).toBe(
			"/mnt/data/signal/attachments",
		);
		// `--config` wins over XDG_DATA_HOME, because it is what the engine was told.
		expect(
			engineAttachmentsRoot({ XDG_DATA_HOME: "/data" }, "/home/you", ["--config", "/mnt/s"]),
		).toBe("/mnt/s/attachments");
	});

	test("takes every name the engine's parser gives that option, short forms included", () => {
		// `addArgument("-d", "--data-dir", "-c", "--config")` is one option in App.java, so a
		// user who wrote `-d /mnt/s` moved their data exactly as far as `--config` would.
		for (const flag of ["--data-dir", "-d", "-c"]) {
			expect(engineAttachmentsRoot({}, "/home/you", [flag, "/mnt/s"])).toBe("/mnt/s/attachments");
		}
		expect(engineAttachmentsRoot({}, "/home/you", ["--data-dir=/mnt/s"])).toBe(
			"/mnt/s/attachments",
		);
	});

	test("resolves a relative --config from the working directory, where the engine starts", () => {
		expect(engineAttachmentsRoot({}, "/home/you", ["--config", "elsewhere"])).toBe(
			`${resolve("elsewhere")}/attachments`,
		);
	});

	test("ignores a --config with nothing after it, and other arguments", () => {
		expect(engineAttachmentsRoot({}, "/home/you", ["--config"])).toBe(
			"/home/you/.local/share/signal-cli/attachments",
		);
		expect(engineAttachmentsRoot({}, "/home/you", ["--verbose", "--config=-x"])).toBe(
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

describe("the files a row offers", () => {
	test("are the ids the engine saved them under, not the names they were sent with", () => {
		// The bug the first real run found: `filename` is `signal-2026-…jpeg`, displayed and
		// meaningless on disk, while the file sits under the attachment id.
		expect(openCandidates(message(), ROOT)).toEqual([{ path: DOWNLOADED, name: "photo.jpg" }]);
		// No name from the sender: the engine's own name is the only one there is.
		expect(openCandidates(message({}, [attachment(LOCAL, { filename: null })]), ROOT)).toEqual([
			{ path: DOWNLOADED, name: LOCAL },
		]);
	});

	test("are every file on the row, in the order the pane draws them", () => {
		// Four files in one message: a key that opened whichever came first would be a silent
		// choice on the user's behalf.
		const four = ["a1.jpg", "a2.pdf", "a3.mp4", "a4.png"];
		const row = message(
			{},
			four.map((id, index) => attachment(id, { filename: `holiday-${index + 1}.jpg` })),
		);

		expect(openCandidates(row, ROOT)).toEqual(
			four.map((id, index) => ({ path: `${ROOT}/${id}`, name: `holiday-${index + 1}.jpg` })),
		);
	});

	test("never turn an id into a path", () => {
		// The id comes off the wire. A separator, a traversal or an absolute path in it is not
		// something the engine writes, and joining it would reach outside the directory.
		for (const id of ["../../../etc/passwd", "/etc/passwd", "..", ".", "a/b.jpg", "a\\b.jpg", ""]) {
			expect(openCandidates(message({}, [attachment(id)]), ROOT)).toEqual([]);
		}
	});

	test("include an absolute filename only when it is inside the directory", () => {
		// An engine version that reports the path it wrote: the same answer as the id rule.
		expect(openCandidates(message({}, [attachment(null, { filename: DOWNLOADED })]), ROOT)).toEqual(
			[{ path: DOWNLOADED, name: DOWNLOADED }],
		);
		// A bare name is a name, not a path — the whole bug in one assertion.
		expect(openCandidates(message({}, [attachment(null, { filename: LOCAL })]), ROOT)).toEqual([]);
		expect(
			openCandidates(message({}, [attachment(null, { filename: "/home/you/.bashrc" })]), ROOT),
		).toEqual([]);
	});

	test("are the ones the engine kept, skipping the rest", () => {
		expect(openCandidates(message({}, [attachment(null), attachment(LOCAL)]), ROOT)).toEqual([
			{ path: DOWNLOADED, name: "photo.jpg" },
		]);
	});
});

describe("what `o` offers on a row", () => {
	test("lists the file the engine downloaded", () => {
		expect(openFiles(message(), CONVERSATION, context())).toEqual({
			kind: "listed",
			files: [{ path: DOWNLOADED, name: "photo.jpg" }],
		});
	});

	test("lists all four files of a four-file row", () => {
		const four = ["a1.jpg", "a2.pdf", "a3.mp4", "a4.png"];
		const fs = fakeFs(four.map((id) => `${ROOT}/${id}`));
		const row = message(
			{},
			four.map((id) => attachment(id)),
		);

		const listed = openFiles(row, CONVERSATION, context(ROOT, fs));
		expect(listed.kind).toBe("listed");
		expect(listed.kind === "listed" ? listed.files.map((file) => file.path) : []).toEqual(
			four.map((id) => `${ROOT}/${id}`),
		);
	});

	test("drops a file that left the disk and keeps the ones that are still there", () => {
		const fs = fakeFs([`${ROOT}/a2.pdf`]);
		const row = message({}, [attachment("a1.jpg"), attachment("a2.pdf")]);

		const listed = openFiles(row, CONVERSATION, context(ROOT, fs));
		expect(listed).toEqual({
			kind: "listed",
			files: [{ path: `${ROOT}/a2.pdf`, name: "photo.jpg" }],
		});
	});

	test("refuses a message that is gone, and a row from another conversation", () => {
		expect(openFiles(undefined, CONVERSATION, context())).toEqual({
			kind: "refused",
			reason: "that message is gone: nothing to open",
		});
		expect(refusal(message({ isDeleted: true }))).toBe("that message was deleted: nothing to open");
		expect(openFiles(message({ conversationId: "uuid-other" }), CONVERSATION, context())).toEqual({
			kind: "refused",
			reason: "that message is not in this conversation",
		});
	});

	test("refuses an expired row and a view-once row: the content was taken away", () => {
		expect(refusal(message({ isExpired: true }))).toBe("that message expired: its file is gone");
		expect(refusal(message({ isViewOnce: true }))).toBe(
			"a view-once file was never stored: nothing to open",
		);
	});

	test("refuses a row with no files, and one whose files the engine never kept", () => {
		expect(refusal(message({}, []))).toBe("that message has no file");
		// `ignoreAttachments`, or our own send: an id of null means no local copy.
		expect(refusal(message({}, [attachment(null)]))).toBe(
			"the engine kept no copy of that file: nothing to open",
		);
	});

	test("says why when every file on the row is gone", () => {
		expect(refusal(message({}, [attachment(LOCAL)]), context(ROOT, fakeFs([])))).toBe(
			"photo.jpg is no longer on disk",
		);
	});
});

describe("launching one file", () => {
	const file = (over: Partial<OpenFile> = {}): OpenFile => ({
		path: DOWNLOADED,
		name: "photo.jpg",
		...over,
	});

	test("hands the canonical path to the opener", () => {
		expect(openPlan(file(), context())).toEqual({
			kind: "open",
			file: { path: DOWNLOADED, name: "photo.jpg" },
		});
	});

	test("refuses a path outside the directory without touching the disk", () => {
		// The root itself may be canonicalised; nothing else may even be looked at.
		const neverAsked: OpenFs = {
			realPath: (path) => {
				if (path === ROOT) {
					return ROOT;
				}
				throw new Error("stat is not allowed for a path nothing vouched for");
			},
			isFile: () => false,
		};
		expect(
			openPlan(file({ path: "/home/you/.bashrc", name: ".bashrc" }), context(ROOT, neverAsked)),
		).toEqual({
			kind: "refused",
			reason: ".bashrc is outside the engine's attachments folder: not opening it",
		});
	});

	test("refuses a file that is no longer there", () => {
		expect(openPlan(file(), context(ROOT, fakeFs([])))).toEqual({
			kind: "refused",
			reason: "photo.jpg is no longer on disk",
		});
	});

	test("refuses a folder inside the directory", () => {
		const folder = `${ROOT}/a-folder`;
		const fs: OpenFs = {
			realPath: (path) => (path === folder ? folder : null),
			isFile: () => false,
		};
		expect(openPlan(file({ path: folder }), context(ROOT, fs))).toEqual({
			kind: "refused",
			reason: "photo.jpg is a folder, not a file",
		});
	});

	test("refuses a link inside the directory that resolves outside it", () => {
		// The text of the path is inside; the file it points at is not. The canonical path is what
		// gets checked, because it is what the opener will be handed.
		const link = `${ROOT}/looks-fine.jpg`;
		const fs = fakeFs(["/home/you/.bashrc"], { [link]: "/home/you/.bashrc" });
		expect(openPlan(file({ path: link }), context(ROOT, fs))).toEqual({
			kind: "refused",
			reason: "photo.jpg points outside the engine's attachments folder: not opening it",
		});
	});

	test("follows a symlinked attachments directory, because the root is canonicalised too", () => {
		// `$XDG_DATA_HOME` on a machine whose data directory is a symlink: the file's real path is
		// outside the root's *text*, and still inside the root's *place*.
		const realRoot = "/srv/data/signal-cli/attachments";
		const real = `${realRoot}/${LOCAL}`;
		const fs: OpenFs = {
			realPath: (path) => (path === ROOT ? realRoot : real),
			isFile: () => true,
		};

		expect(openPlan(file(), context(ROOT, fs))).toEqual({
			kind: "open",
			file: { path: real, name: "photo.jpg" },
		});
	});
});

describe("what the status line advertises", () => {
	test("names a row with a file the engine kept, and nothing else", () => {
		expect(canOpen(message(), ROOT)).toBe(true);
		expect(canOpen(message({}, [attachment("a1.jpg"), attachment("a2.jpg")]), ROOT)).toBe(true);
		expect(canOpen(message({}, [attachment(null)]), ROOT)).toBe(false);
		expect(canOpen(message({}, [attachment(null, { filename: "/home/you/cv.pdf" })]), ROOT)).toBe(
			false,
		);
		expect(canOpen(message({}, []), ROOT)).toBe(false);
	});
});
