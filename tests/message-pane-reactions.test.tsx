import { describe, expect, test } from "bun:test";
import type { Conversation, Message, Reaction } from "../src/domain/types";
import { MessagePane } from "../src/ui/message-pane";
import { frameOf as renderFrame } from "./helpers/frame";

const conversation: Conversation = {
	id: "c1",
	name: "Marta",
	unreadCount: 0,
	lastActivityAt: 0,
};

const reaction = (overrides: Partial<Reaction> = {}): Reaction => ({
	emoji: "👍",
	author: "Marta",
	authorId: "uuid-marta",
	...overrides,
});

const message = (overrides: Partial<Message> = {}): Message => ({
	id: "m1",
	conversationId: "c1",
	author: "Marta",
	body: "on my way",
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
			width={60}
			clock={() => "10:00"}
		/>,
	);

const rows = (frame: string): number =>
	frame.split("\n").filter((line) => line.trim().length > 0).length;

describe("MessagePane reactions", () => {
	test("draws the markers on the author row", () => {
		const frame = frameOf([
			message({ reactions: [reaction(), reaction({ authorId: "uuid-bob", author: "Bob" })] }),
		]);

		expect(frame).toContain("10:00 Marta 👍 2");
	});

	test("costs no extra row", () => {
		// The claim is equality: a marker on its own line would change this count.
		const without = frameOf([message()]);
		const withReaction = frameOf([message({ reactions: [reaction()] })]);

		expect(rows(withReaction)).toBe(rows(without));
		expect(withReaction).toContain("👍");
	});

	test("a message with no reactions draws none", () => {
		expect(frameOf([message()])).not.toContain("👍");
	});
});
