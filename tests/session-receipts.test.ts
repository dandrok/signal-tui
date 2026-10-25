import { describe, expect, test } from "bun:test";
import { createSession } from "../src/app/session";
import { DIRECT_ID, FakeBackend, message, RecordingStore } from "./helpers/session-fakes";

describe("createSession receipts", () => {
	test("a receipt from the other side marks our message and wakes the UI", async () => {
		const store = new RecordingStore();
		const backend = new FakeBackend();
		const session = createSession({ store, backend });
		store.messages.set(DIRECT_ID, [
			{ ...message(), id: "m1", conversationId: DIRECT_ID, sentAt: 100, isOutgoing: true },
			{ ...message(), id: "m2", conversationId: DIRECT_ID, sentAt: 200, isOutgoing: true },
		]);

		let changes = 0;
		session.onChange(() => {
			changes += 1;
		});

		backend.emit({ kind: "receipt", timestamps: [100], state: "read" });
		await session.flush();

		const [acknowledged, untouched] = store.messages.get(DIRECT_ID) ?? [];
		expect(acknowledged?.receipt).toBe("read");
		// The second message was not in the receipt, so it stays unacknowledged.
		expect(untouched?.receipt).toBeUndefined();
		expect(changes).toBe(1);
	});

	test("a receipt the cache cannot place is still applied without inserting anything", async () => {
		const store = new RecordingStore();
		const backend = new FakeBackend();
		const session = createSession({ store, backend });
		store.messages.set(DIRECT_ID, []);

		backend.emit({ kind: "receipt", timestamps: [404], state: "delivered" });
		await session.flush();

		expect(store.receipts).toEqual([{ timestamps: [404], state: "delivered" }]);
		// No message is invented for an acknowledgement of something we never stored.
		expect(store.savedMessages).toHaveLength(0);
		expect(store.messages.get(DIRECT_ID)).toEqual([]);
	});
});
