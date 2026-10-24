import { describe, expect, test } from "bun:test";
import { createSession } from "../src/app/session";
import { DIRECT_ID, FakeBackend, message, RecordingStore } from "./helpers/session-fakes";

describe("createSession edits", () => {
	test("an edit replaces the cached body and wakes the UI", async () => {
		const store = new RecordingStore();
		const backend = new FakeBackend();
		const session = createSession({ store, backend });
		store.messages.set(DIRECT_ID, [{ ...message(), body: "typo here", sentAt: 100 }]);

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

		expect(store.messages.get(DIRECT_ID)?.[0]?.body).toBe("typo fixed");
		expect(store.ops).toEqual([`applyEdit:${DIRECT_ID}:100:typo fixed`]);
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
