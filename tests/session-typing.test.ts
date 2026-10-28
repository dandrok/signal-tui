import { describe, expect, test } from "bun:test";
import { createSession } from "../src/app/session";
import { TYPING_TTL_MS } from "../src/app/session/typing";
import { FakeBackend, RecordingStore } from "./helpers/session-fakes";

/**
 * Typing lives in the session and nowhere else: no queue, no store, no cache. That is the whole
 * point — a notice about the present must not survive a restart, or the client opens tomorrow
 * showing someone composing a message they sent last night.
 */

const CONVERSATION = "uuid-mum";

const started = {
	kind: "typing",
	conversationId: CONVERSATION,
	author: "Mum",
	isTyping: true,
} as const;
const stopped = { ...started, isTyping: false } as const;

const setup = () => {
	let clock = 1_000_000;
	const store = new RecordingStore();
	const backend = new FakeBackend();
	const session = createSession({ store, backend, clock: () => clock });
	let changes = 0;
	session.onChange(() => {
		changes += 1;
	});
	return {
		session,
		store,
		backend,
		advance: (by: number) => {
			clock += by;
		},
		changes: () => changes,
	};
};

describe("typing in the session", () => {
	test("a notice shows an author and writes nothing at all", async () => {
		const { session, backend, store } = setup();

		expect(session.typingIn(CONVERSATION)).toBeNull();
		backend.emit(started);

		expect(session.typingIn(CONVERSATION)).toBe("Mum");
		// The store saw nothing: not a conversation, not a message, not an unread count.
		expect(store.ops).toEqual([]);
		await session.flush();
		expect(store.ops).toEqual([]);
	});

	test("STOPPED takes the line away immediately", () => {
		const { session, backend } = setup();

		backend.emit(started);
		backend.emit(stopped);

		expect(session.typingIn(CONVERSATION)).toBeNull();
	});

	test("a notice that is never followed by STOPPED fades on its own", () => {
		// A peer who walks away mid-sentence sends STARTED and nothing else, so the deadline is
		// the only thing that ends it.
		const { session, backend, advance } = setup();

		backend.emit(started);
		advance(TYPING_TTL_MS - 1);
		expect(session.typingIn(CONVERSATION)).toBe("Mum");

		advance(1);
		expect(session.typingIn(CONVERSATION)).toBeNull();
	});

	test("a repeated notice does not redraw, and a STOPPED for nothing is not news", () => {
		const { backend, changes } = setup();

		backend.emit(stopped);
		expect(changes()).toBe(0);

		backend.emit(started);
		expect(changes()).toBe(1);

		// The same author, still writing: the line on screen would not change.
		backend.emit(started);
		expect(changes()).toBe(1);

		backend.emit(stopped);
		expect(changes()).toBe(2);
	});

	test("each conversation keeps its own author", () => {
		const { session, backend } = setup();

		backend.emit(started);
		backend.emit({ kind: "typing", conversationId: "uuid-dad", author: "Dad", isTyping: true });

		expect(session.typingIn(CONVERSATION)).toBe("Mum");
		expect(session.typingIn("uuid-dad")).toBe("Dad");
		expect(session.typingIn("uuid-nobody")).toBeNull();
	});
});
