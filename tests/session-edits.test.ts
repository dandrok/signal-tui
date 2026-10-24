import { describe, expect, test } from "bun:test";
import { createSession } from "../src/app/session";
import { DIRECT_ID, FakeBackend, message, RecordingStore } from "./helpers/session-fakes";

describe("createSession edits", () => {
	test("an edit replaces the targeted message and wakes the UI", async () => {
		const store = new RecordingStore();
		const backend = new FakeBackend();
		const session = createSession({ store, backend });
		// Two messages in the same conversation: only the one the edit targets changes.
		store.messages.set(DIRECT_ID, [
			{ ...message(), id: "m1", sentAt: 100, body: "typo here" },
			{ ...message(), id: "m2", sentAt: 200, body: "untouched" },
		]);

		let changes = 0;
		session.onChange(() => {
			changes += 1;
		});

		backend.emit({
			kind: "message-edited",
			conversationId: DIRECT_ID,
			targetSentAt: 100,
			body: "typo fixed",
		});
		await session.flush();

		const [targeted, other] = store.messages.get(DIRECT_ID) ?? [];
		expect(targeted?.body).toBe("typo fixed");
		expect(targeted?.isEdited).toBe(true);
		expect(other?.body).toBe("untouched");
		expect(other?.isEdited).toBeUndefined();
		expect(changes).toBe(1);
	});

	test("a failing edit is recorded, not thrown at the caller", async () => {
		const store = new RecordingStore();
		store.failOn = "applyEdit";
		const backend = new FakeBackend();
		const session = createSession({ store, backend });

		backend.emit({
			kind: "message-edited",
			conversationId: DIRECT_ID,
			targetSentAt: 100,
			body: "typo fixed",
		});
		await session.flush();

		expect(session.errors.join(" ")).toContain("applyEdit failed");
	});
});
