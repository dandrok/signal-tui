import { describe, expect, test } from "bun:test";
import { render, Text } from "ink";
import type { ReactElement } from "react";
import { attachmentLine, describeAuthor, describeBody, displayName } from "../src/domain/format";
import type { Conversation, Message } from "../src/domain/types";
import { MessagePane } from "../src/ui/message-pane";
import { stubClock } from "./helpers/clock";

/**
 * Everything ink writes to the terminal, as one string. `ink-testing-library`
 * strips ANSI, which is exactly what a security test must not do: the point is
 * what reaches the terminal.
 */
const rawOutput = (element: ReactElement): string => {
	const chunks: string[] = [];
	const stdout = {
		write: (chunk: string): boolean => {
			chunks.push(chunk);
			return true;
		},
		columns: 80,
		rows: 24,
		isTTY: true,
		on: () => undefined,
		off: () => undefined,
		once: () => undefined,
		removeListener: () => undefined,
		removeAllListeners: () => undefined,
		emit: () => undefined,
	};
	const instance = render(element, {
		// biome-ignore lint/suspicious/noExplicitAny: ink's Options type wants a full WriteStream
		stdout: stdout as any,
		patchConsole: false,
	});
	instance.unmount();
	return chunks.join("");
};

const conversation: Conversation = {
	id: "c1",
	name: "invoice\u202Etxt.exe",
	unreadCount: 0,
	lastActivityAt: 0,
};

const hostile: Message = {
	id: "m1",
	conversationId: "c1",
	author: "\u001b[8mhidden\u001b[0m",
	body: "\u001b[31mRED\u001b[0m and \u001b]52;c;cHduZWQ=\u0007done",
	sentAt: 0,
	isOutgoing: false,
	isDeleted: false,
	attachments: [
		{
			id: "a1",
			contentType: "image/png",
			filename: "/tmp/\u001b[35mevil\u001b[0m.png",
			size: 1024,
			caption: null,
			isVoiceNote: false,
		},
	],
};

const clock = stubClock();

describe("terminal safety", () => {
	test("a hostile body reaches the terminal without its directives", () => {
		const raw = rawOutput(<Text>{describeBody(hostile)}</Text>);

		expect(raw).toContain("RED");
		expect(raw).toContain("done");
		expect(raw).not.toContain("\u001b[31m");
		expect(raw).not.toContain("\u001b]52");
	});

	test("an author name cannot conceal itself or break the row", () => {
		const name = describeAuthor(hostile);
		const raw = rawOutput(<Text>{name}</Text>);

		expect(name).toContain("hidden");
		expect(name).not.toContain("\u001b[8m");
		// A label measured as one row must stay one row: a newline in a name would
		// add rows the pane never budgeted.
		expect(name).not.toContain("\n");
		expect(raw).not.toContain("\u001b[8m");
	});

	test("a group name cannot reverse its own characters", () => {
		// Ink 8 drops bidi controls on its own (verified against the installed build),
		// so this asserts the domain guarantee instead of ink's behaviour: the strip
		// belongs to us and must survive a renderer change.
		const name = displayName(conversation);

		expect(name).toContain("invoice");
		expect(name).toContain("txt.exe");
		expect(name).not.toMatch(/[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/);
		expect(rawOutput(<Text>{name}</Text>)).toContain("invoicetxt.exe");
	});

	test("a filename reaches the terminal as plain text", () => {
		const attachment = hostile.attachments?.[0];
		expect(attachment).toBeDefined();
		const raw = rawOutput(<Text>{attachmentLine(attachment as never)}</Text>);

		expect(raw).toContain("evil");
		expect(raw).toContain(".png");
		expect(raw).not.toContain("\u001b[35m");
	});

	test("the whole pane renders hostile content without escape sequences of its own", () => {
		const raw = rawOutput(
			<MessagePane
				conversation={conversation}
				messages={[hostile]}
				height={10}
				width={60}
				clock={clock}
			/>,
		);

		// Ink emits SGR of its own for the border and title, and strips bidi itself;
		// what must not appear is the payload's own red (31) or 256-colour background.
		expect(raw).not.toContain("\u001b[31m");
		expect(raw).not.toContain("\u001b[48;5;");
		expect(raw).toContain("RED");
		expect(raw).toContain("evil");
	});
});
