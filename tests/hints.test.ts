import { describe, expect, test } from "bun:test";
import { type AppState, emptyState } from "../src/app/state";
import type { Message } from "../src/domain/types";
import { SELF_AUTHOR_ID } from "../src/domain/types";
import { hintsFor } from "../src/ui/hints";

/**
 * The status line has to agree with the keymap in both directions: a hint for a key that does
 * nothing is a lie, and a key with no hint is a secret.
 *
 * The one that bites is ownership — `e` and `d` change a message we wrote, so they are
 * advertised only while the pointer is on one of ours. `r`, `x` and `D` work on anyone's
 * message: replying and reacting say something about *us*, and hiding is a local decision
 * about a row rather than a claim about who wrote it.
 */

const CONVERSATION = "+48123456789";

const message = (over: Partial<Message> = {}): Message => ({
	id: `${CONVERSATION}:1000`,
	conversationId: CONVERSATION,
	author: "Amber",
	authorId: "uuid-amber",
	body: "dinner at 7?",
	sentAt: 1_000,
	isOutgoing: false,
	isDeleted: false,
	attachments: [],
	...over,
});

const stateWith = (target: Message): AppState => ({
	...emptyState,
	focus: "messages",
	selectedId: CONVERSATION,
	conversations: [{ id: CONVERSATION, name: "Amber", unreadCount: 0, lastActivityAt: 1_000 }],
	messagesByConversation: { [CONVERSATION]: [target] },
});

describe("the message pane's hint", () => {
	test("our own message offers edit and delete", () => {
		const line = hintsFor(
			stateWith(message({ isOutgoing: true, authorId: SELF_AUTHOR_ID })),
			false,
		);

		expect(line).toContain("e edit");
		expect(line).toContain("d delete");
		expect(line).toContain("r reply");
		expect(line).toContain("x react");
		expect(line).toContain("f forward");
		expect(line).toContain("a attach");
		expect(line).toContain("D hide");
	});

	test("someone else's message offers neither", () => {
		// The point of this test: no `e`, no `d`, and no placeholder for them either — a
		// disabled-looking key is the same promise as a working one.
		const line = hintsFor(stateWith(message()), false);

		expect(line).not.toContain("e edit");
		expect(line).not.toContain("d delete");
		expect(line).toContain("r reply");
		expect(line).toContain("x react");
		expect(line).toContain("f forward");
		expect(line).toContain("D hide");
	});

	test("a message with files offers no forward, though the same words do", () => {
		// Both halves in one test: the positive control is what proves the absence below is
		// `canForward` saying no, and not the hint having dropped the key for everyone.
		const files = [
			{
				id: null,
				contentType: "image/jpeg",
				filename: "/tmp/photo.jpg",
				size: 2_048,
				caption: null,
				isVoiceNote: false,
			},
		];
		const line = (over: Partial<Message>): string => hintsFor(stateWith(message(over)), false);

		expect(line({})).toContain("f forward");
		expect(line({ attachments: files })).not.toContain("f forward");
	});

	test("a deleted message of ours offers no edit, no delete and no forward", () => {
		// One helper, two rows: the same message before and after it is deleted. The positives
		// are what prove the absences below are the per-message rules, not a hint that dropped
		// the keys for everybody.
		const line = (over: Partial<Message>): string =>
			hintsFor(stateWith(message({ isOutgoing: true, authorId: SELF_AUTHOR_ID, ...over })), false);

		expect(line({})).toContain("e edit");
		expect(line({})).toContain("d delete");
		expect(line({})).toContain("f forward");
		expect(line({ isDeleted: true })).not.toContain("e edit");
		expect(line({ isDeleted: true })).not.toContain("d delete");
		expect(line({ isDeleted: true })).not.toContain("f forward");
	});

	test("a prompt owns the line while it is open", () => {
		const hint = (kind: "reaction" | "edit" | "delete" | "forward" | "attach"): string =>
			hintsFor(
				{
					...stateWith(message({ isOutgoing: true, authorId: SELF_AUTHOR_ID })),
					prompt: { kind, targetId: `${CONVERSATION}:1000`, draft: "", pick: 0 },
				},
				false,
			);

		expect(hint("reaction")).toContain("send");
		expect(hint("edit")).toContain("save");
		expect(hint("delete")).toContain("delete for everyone");
		expect(hint("forward")).toContain("pick");
		// Two ways to confirm, because a folder is a step and a file is the message.
		expect(hint("attach")).toContain("open");
	});
});
