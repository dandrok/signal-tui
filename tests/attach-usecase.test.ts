import { describe, expect, test } from "bun:test";
import {
	type AttachFs,
	attachListing,
	attachPlan,
	draftSplit,
	MAX_ATTACHMENT_BYTES,
	MAX_SUGGESTIONS,
} from "../src/app/usecases/attach";

/**
 * The path prompt is the one place this client reads the filesystem directly, so everything here
 * is about *not* surprising anyone: a half-typed path lists rather than fails, a dotfile stays
 * out of the way until asked for, a directory is a step rather than a message, and nothing is
 * sent that the engine would reject one upload later.
 */

const CWD = "/home/someone/work";
const HOME = "/home/someone";

const entry = (name: string, isDirectory = false) => ({ name, isDirectory });

const fakeFs = (
	tree: Record<string, readonly { name: string; isDirectory: boolean }[]>,
	sizes: Record<string, number | null>,
): AttachFs => ({
	list: (directory) => {
		const entries = tree[directory];
		if (entries === undefined) {
			throw new Error(`ENOENT: ${directory}`);
		}
		return entries;
	},
	sizeOf: (path) => {
		if (!(path in sizes)) {
			throw new Error(`ENOENT: ${path}`);
		}
		return sizes[path] ?? null;
	},
});

const context = (fs: AttachFs) => ({ cwd: CWD, home: HOME, fs });

/** A working directory with a folder, two files, a dotfile and a big one. */
const workspace = () =>
	context(
		fakeFs(
			{
				"/home/someone/work": [
					entry("photos", true),
					entry("cv.pdf"),
					entry(".env"),
					entry("CV.DOCX"),
				],
				"/home/someone/work/photos": [entry("cat.jpg")],
				"/home/someone/docs": [entry("letter.pdf")],
				"/home/someone": [entry("docs", true), entry("img.png")],
			},
			{
				"/home/someone/work/cv.pdf": 120,
				"/home/someone/work/CV.DOCX": 300,
				"/home/someone/work/photos": null,
				"/home/someone/work/photos/cat.jpg": 40,
				"/home/someone/docs/letter.pdf": 10,
				"/home/someone/work/.env": 5,
			},
		),
	);

describe("draftSplit", () => {
	test("an empty draft lists the directory the client was started in", () => {
		expect(draftSplit("", { cwd: CWD, home: HOME })).toEqual({ directory: CWD, filter: "" });
	});

	test("a trailing slash means the directory itself", () => {
		expect(draftSplit("photos/", { cwd: CWD, home: HOME })).toEqual({
			directory: `${CWD}/photos`,
			filter: "",
		});
	});

	test("anything else splits into the directory to read and the name to match", () => {
		expect(draftSplit("photos/cat", { cwd: CWD, home: HOME })).toEqual({
			directory: `${CWD}/photos`,
			filter: "cat",
		});
	});

	test("~ is the home directory, because that is how a person types a path", () => {
		// Without the slash it is an entry *in* home — the same rule as anywhere else — and with
		// it, the listing of that entry.
		expect(draftSplit("~/docs", { cwd: CWD, home: HOME })).toEqual({
			directory: HOME,
			filter: "docs",
		});
		expect(draftSplit("~/docs/", { cwd: CWD, home: HOME })).toEqual({
			directory: `${HOME}/docs`,
			filter: "",
		});
		expect(draftSplit("~/docs/let", { cwd: CWD, home: HOME })).toEqual({
			directory: `${HOME}/docs`,
			filter: "let",
		});
	});

	test("an absolute path is used as it is", () => {
		expect(draftSplit("/etc/hosts", { cwd: CWD, home: HOME })).toEqual({
			directory: "/etc",
			filter: "hosts",
		});
	});
});

describe("attachListing", () => {
	test("the prefix is matched without case, and folders still come first", () => {
		const listing = attachListing("cv", 0, workspace());

		// `cv` matches cv.pdf and CV.DOCX; both are files, so the order is locale-alphabetical.
		expect(listing.candidates.map((candidate) => candidate.name).sort()).toEqual([
			"CV.DOCX",
			"cv.pdf",
		]);
	});

	test("an empty draft lists the directory, folders before files", () => {
		const listing = attachListing("", 0, workspace());

		expect(listing.candidates[0]).toEqual({
			name: "photos",
			path: `${CWD}/photos`,
			isDirectory: true,
			size: null,
		});
		expect(listing.candidates.map((candidate) => candidate.name)).toContain("cv.pdf");
	});

	test("dotfiles stay out of the list until the dot is typed", () => {
		// `~` and a home directory are full of them; a picker that opens on `.bashrc` when
		// someone typed `ba` is worse than one that shows nothing.
		expect(attachListing("", 0, workspace()).candidates.map((c) => c.name)).not.toContain(".env");
		expect(attachListing(".e", 0, workspace()).candidates.map((c) => c.name)).toEqual([".env"]);
	});

	test("the list is capped, and says how many it did not show", () => {
		const many = context(
			fakeFs(
				{
					[CWD]: Array.from({ length: MAX_SUGGESTIONS + 3 }, (_, index) => entry(`f${index}.txt`)),
				},
				{},
			),
		);
		const listing = attachListing("", 0, many);

		expect(listing.candidates).toHaveLength(MAX_SUGGESTIONS);
		expect(listing.hidden).toBe(3);
	});

	test("a directory that cannot be read is an empty list, not a crash", () => {
		// Half a typed path is the normal state of a prompt.
		expect(attachListing("/nope/deep", 0, workspace())).toEqual({
			directory: "/nope",
			candidates: [],
			picked: 0,
			hidden: 0,
		});
	});

	test("the highlight is clamped to what the filter left", () => {
		expect(attachListing("cv", 9, workspace()).picked).toBe(1);
	});
});

describe("attachPlan", () => {
	test("a file becomes a path, a name and a size", () => {
		expect(attachPlan("cv.pdf", workspace())).toEqual({
			kind: "send",
			file: { path: `${CWD}/cv.pdf`, name: "cv.pdf", size: 120 },
		});
	});

	test("a directory is refused with the sentence that says what to do instead", () => {
		const plan = attachPlan("photos", workspace());

		expect(plan.kind).toBe("refused");
		expect(plan.kind === "refused" ? plan.reason : "").toContain("is a directory");
	});

	test("a path that is not there says so, by name", () => {
		const plan = attachPlan("nope.txt", workspace());

		expect(plan.kind === "refused" ? plan.reason : "").toContain("nothing at");
	});

	test("an empty file is refused, because it arrives looking broken", () => {
		const empty = context(fakeFs({ [CWD]: [entry("zero.txt")] }, { [`${CWD}/zero.txt`]: 0 }));
		const plan = attachPlan("zero.txt", empty);

		expect(plan.kind === "refused" ? plan.reason : "").toContain("is empty");
	});

	test("a file over the cap is refused before a 100 MB upload starts", () => {
		const big = context(
			fakeFs({ [CWD]: [entry("film.mkv")] }, { [`${CWD}/film.mkv`]: MAX_ATTACHMENT_BYTES + 1 }),
		);
		const plan = attachPlan("film.mkv", big);

		expect(plan.kind === "refused" ? plan.reason : "").toContain("100 MB");
	});

	test("an empty draft asks for a path instead of guessing one", () => {
		const plan = attachPlan("   ", workspace());

		expect(plan.kind === "refused" ? plan.reason : "").toContain("type a path");
	});

	test("a file right at the cap is allowed", () => {
		const edge = context(
			fakeFs({ [CWD]: [entry("ok.mkv")] }, { [`${CWD}/ok.mkv`]: MAX_ATTACHMENT_BYTES }),
		);

		expect(attachPlan("ok.mkv", edge).kind).toBe("send");
	});
});
