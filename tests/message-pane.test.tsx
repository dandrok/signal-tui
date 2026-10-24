import { describe, expect, test } from "bun:test";
import type { Attachment, Conversation, Message } from "../src/domain/types";
import { clockFor } from "../src/ui/clock";
import { MessagePane } from "../src/ui/MessagePane";
import { frameOf as renderFrame } from "./helpers/frame";

const conversation: Conversation = {
	id: "c1",
	name: "Marta",
	unreadCount: 0,
	lastActivityAt: 0,
};

const attachment = (overrides: Partial<Attachment> = {}): Attachment => ({
	id: "a1",
	contentType: "image/png",
	filename: "/home/you/attachments/screenshot-limit.png",
	size: 412_000,
	caption: null,
	isVoiceNote: false,
	...overrides,
});

const message = (overrides: Partial<Message> = {}): Message => ({
	id: "m1",
	conversationId: "c1",
	author: "Marta",
	body: "",
	sentAt: 0,
	isOutgoing: false,
	isDeleted: false,
	...overrides,
});

const frameOf = (messages: readonly Message[]): string =>
	renderFrame(
		<MessagePane
			conversation={conversation}
			messages={messages}
			height={20}
			clock={clockFor("UTC")}
		/>,
	);

describe("MessagePane attachments", () => {
	test("names the file and its size", () => {
		const frame = frameOf([message({ attachments: [attachment()] })]);

		expect(frame).toContain("screenshot-limit.png");
		expect(frame).toContain("402 KB");
	});

	test("shows one line per file", () => {
		const frame = frameOf([
			message({
				attachments: [
					attachment(),
					attachment({ id: "a2", filename: "/tmp/report.pdf", size: 1024 }),
				],
			}),
		]);

		expect(frame).toContain("screenshot-limit.png");
		expect(frame).toContain("report.pdf");
	});

	test("labels a voice note that has no filename", () => {
		const frame = frameOf([
			message({ attachments: [attachment({ filename: null, isVoiceNote: true, size: 61_440 })] }),
		]);

		expect(frame).toContain("voice note");
	});

	test("does not repeat the placeholder when files are the whole message", () => {
		const frame = frameOf([message({ body: "[attachment]", attachments: [attachment()] })]);

		expect(frame).toContain("screenshot-limit.png");
		expect(frame).not.toContain("[attachment]");
	});

	test("keeps the caption text as the body when there is one", () => {
		const frame = frameOf([
			message({ body: "the 4 MiB limit, measured", attachments: [attachment()] }),
		]);

		expect(frame).toContain("the 4 MiB limit, measured");
	});

	test("hides files of a deleted message", () => {
		const frame = frameOf([message({ isDeleted: true, attachments: [attachment()] })]);

		expect(frame).toContain("message deleted");
		expect(frame).not.toContain("screenshot-limit.png");
	});
});
