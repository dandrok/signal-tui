import { describe, expect, test } from "bun:test";
import type { Clock } from "../src/domain/format";
import type { Message } from "../src/domain/types";
import { Composer } from "../src/ui/Composer";
import { stubClock } from "./helpers/clock";
import { frameOf as renderFrame } from "./helpers/frame";

/** A stub clock: layout assertions must not depend on ICU formatting or the host zone. */
const clock: Clock = stubClock();

const target = (overrides: Partial<Message> = {}): Message => ({
	id: "c1:1000",
	conversationId: "c1",
	author: "Marta",
	authorId: "uuid-marta",
	body: "attachments path also needs the 4 MiB limit",
	sentAt: 1_000,
	isOutgoing: false,
	isDeleted: false,
	...overrides,
});

const frameOf = (replyTo?: Message): string =>
	renderFrame(
		<Composer draft="agreed" isFocused={true} width={60} replyTo={replyTo} clock={clock} />,
	);

const rows = (frame: string): number =>
	frame.split("\n").filter((line) => line.trim().length > 0).length;

describe("Composer replying", () => {
	test("draws the message the draft answers", () => {
		const frame = frameOf(target());

		expect(frame).toContain("┃ 10:00 Marta: attachments path also needs the 4 MiB");
		// The prompt row is still there, below it.
		expect(frame).toContain("agreed");
	});

	test("says when the quoted author is us", () => {
		expect(frameOf(target({ isOutgoing: true, author: "You", authorId: "self" }))).toContain(
			"┃ 10:00 You",
		);
	});

	test("costs one extra row, and only while replying", () => {
		expect(rows(frameOf(target()))).toBe(rows(frameOf()) + 1);
		expect(frameOf()).not.toContain("┃");
	});

	test("a plain draft shows no quote block", () => {
		const frame = frameOf();
		expect(frame).not.toContain("┃");
		expect(frame).toContain("agreed");
	});
});
