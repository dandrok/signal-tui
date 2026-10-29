import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import {
	canOpen,
	engineAttachmentsRoot,
	inAttachmentsDir,
	type OpenContext,
	type OpenFs,
	openCandidate,
	openPlan,
} from "../src/app/usecases/open";
import type { Attachment, Message } from "../src/domain/types";

/**
 * Opening a file someone sent, as a verdict: which path a row would hand to the desktop, and the
 * sentence that says why it is not going to.
 *
 * Two rules are being pinned, and both were wrong in the first cut. The file on disk is
 * `<data-dir>/attachments/<id>` — the engine reports the original name as `filename`, which names
 * nothing — and **only that directory is reachable**: every case below is a way in that has to be
 * closed, because a terminal that launches whatever a message names is remote code execution with
 * a keybinding.
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

const context = (fs: OpenFs = fakeFs([DOWNLOADED])): OpenContext => ({
	root: ROOT,
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

describe("where a row's file actually is", () => {
	test("is the id the engine saved it under, not the name it was sent with", () => {
		// The bug the first real run found: `filename` is `signal-2026-…jpeg`, displayed and
		// meaningless on disk, while the file sits under the attachment id.
		expect(openCandidate(message(), ROOT)).toEqual({ path: DOWNLOADED, name: "photo.jpg" });
		// No name from the sender: the engine's own name is the only one there is.
		expect(openCandidate(message({}, [attachment(LOCAL, { filename: null })]), ROOT)).toEqual({
			path: DOWNLOADED,
			name: LOCAL,
		});
	});

	test("never turns an id into a path", () => {
		// The id comes off the wire. A separator, a traversal or an absolute path in it is not
		// something the engine writes, and joining it would reach outside the directory.
		for (const id of ["../../../etc/passwd", "/etc/passwd", "..", ".", "a/b.jpg", "a\\b.jpg", ""]) {
			expect(openCandidate(message({}, [attachment(id)]), ROOT)).toBeNull();
		}
	});

	test("skips a file the engine did not keep and takes the next one", () => {
		expect(openCandidate(message({}, [attachment(null), attachment(LOCAL)]), ROOT)?.path).toBe(
			DOWNLOADED,
		);
	});

	test("accepts an absolute filename only when it is inside the directory", () => {
		// An engine version that reports the path it wrote: the same answer as the id rule.
		expect(openCandidate(message({}, [attachment(null, { filename: DOWNLOADED })]), ROOT)).toEqual({
			path: DOWNLOADED,
			name: DOWNLOADED,
		});
		expect(
			openCandidate(message({}, [attachment(null, { filename: "/home/you/.bashrc" })]), ROOT),
		).toBeNull();
		// A bare name is a name, not a path — the whole bug in one assertion.
		expect(openCandidate(message({}, [attachment(null, { filename: LOCAL })]), ROOT)).toBeNull();
	});
});

describe("what `o` does on a row", () => {
	test("opens the file the engine downloaded", () => {
		const plan = openPlan(message(), CONVERSATION, context());

		expect(plan).toEqual({
			kind: "open",
			file: { path: DOWNLOADED, name: "photo.jpg" },
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

	test("refuses a row with no files, and one whose file the engine never kept", () => {
		expect(refusal(message({}, []))).toBe("that message has no file");
		// `ignoreAttachments`, or our own send: an id of null means no local copy.
		expect(refusal(message({}, [attachment(null)]))).toBe(
			"the engine kept no copy of that file: nothing to open",
		);
	});

	test("refuses a file that left the disk after the row was cached", () => {
		expect(refusal(message(), context(fakeFs([])))).toBe("photo.jpg is no longer on disk");
	});

	test("refuses a folder inside the directory", () => {
		const folder = `${ROOT}/a-folder`;
		const fs: OpenFs = {
			realPath: (path) => (path === folder ? folder : null),
			isFile: () => false,
		};
		expect(refusal(message({}, [attachment("a-folder")]), context(fs))).toBe(
			"photo.jpg is a folder, not a file",
		);
	});

	test("refuses a link inside the directory that resolves outside it", () => {
		// The text of the path is inside; the file it points at is not. The canonical path is what
		// gets checked, because it is what the opener will be handed.
		const link = `${ROOT}/looks-fine.jpg`;
		const fs = fakeFs(["/home/you/.bashrc"], { [link]: "/home/you/.bashrc" });
		expect(refusal(message({}, [attachment("looks-fine.jpg")]), context(fs))).toBe(
			"photo.jpg points outside the engine's attachments folder: not opening it",
		);
	});

	test("follows a symlinked attachments directory, because the root is canonicalised too", () => {
		// `$XDG_DATA_HOME` on a machine whose data directory is a symlink: the file's real path is
		// outside the root's *text*, and still inside the root's *place*.
		const realRoot = "/srv/data/signal-cli/attachments";
		const file = `${realRoot}/${LOCAL}`;
		const fs: OpenFs = {
			realPath: (path) => (path === ROOT ? realRoot : file),
			isFile: () => true,
		};

		expect(
			openPlan(message(), CONVERSATION, { root: ROOT, fs, launch: async () => undefined }),
		).toEqual({
			kind: "open",
			file: { path: file, name: "photo.jpg" },
		});
	});

	test("opens our own row only when the engine kept the file there too", () => {
		// A reply we sent echoes `filename` as the path we picked and `id` as null: the rule is
		// about the engine's copy, not about who wrote the message.
		expect(
			refusal(message({ isOutgoing: true }, [attachment(null, { filename: "/home/you/cv.pdf" })])),
		).toBe("the engine kept no copy of that file: nothing to open");
	});
});

describe("what the status line advertises", () => {
	test("names a file the engine kept, and nothing else", () => {
		expect(canOpen(message(), ROOT)).toBe(true);
		expect(canOpen(message({}, [attachment(null)]), ROOT)).toBe(false);
		expect(canOpen(message({}, [attachment(null, { filename: "/home/you/cv.pdf" })]), ROOT)).toBe(
			false,
		);
		expect(canOpen(message({}, []), ROOT)).toBe(false);
	});
});
