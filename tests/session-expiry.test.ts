import { describe, expect, test } from "bun:test";
import { createSession } from "../src/app/session";
import { DIRECT_ID, FakeBackend, message, RecordingStore } from "./helpers/session-fakes";

/**
 * Expiry has to be enforced by whoever is running, not only when a conversation is
 * opened — otherwise a message nobody looks at keeps its text on disk until the next
 * launch. The clock is injected so none of this sleeps.
 */
describe("createSession expiry", () => {
	test("start clears what expired while the app was closed", async () => {
		const store = new RecordingStore();
		const backend = new FakeBackend();
		store.messages.set(DIRECT_ID, [
			{
				...message(),
				id: "m1",
				conversationId: DIRECT_ID,
				sentAt: 1_000,
				body: "gone by now",
				expiresAt: 5_000,
			},
		]);
		const session = createSession({ store, backend, clock: () => 6_000 });

		await session.start();
		await session.flush();

		expect(store.purges).toEqual([6_000]);
		const [purged] = store.messages.get(DIRECT_ID) ?? [];
		expect(purged?.body).toBe("");
		expect(purged?.isExpired).toBe(true);
	});

	test("an arriving envelope sweeps the conversation it does not belong to", async () => {
		const store = new RecordingStore();
		const backend = new FakeBackend();
		store.messages.set(DIRECT_ID, [
			{
				...message(),
				id: "m1",
				conversationId: DIRECT_ID,
				sentAt: 1_000,
				body: "quietly expired",
				expiresAt: 2_000,
			},
		]);
		const session = createSession({ store, backend, clock: () => 9_000 });

		// Any event is a chance to purge; this one is about a different conversation.
		backend.emit({
			kind: "message",
			message: { ...message(), id: "m2", conversationId: "uuid-other", sentAt: 9_000 },
		});
		await session.flush();

		const [swept] = store.messages.get(DIRECT_ID) ?? [];
		expect(swept?.body).toBe("");
		expect(swept?.isExpired).toBe(true);
		expect(swept?.attachments).toEqual([]);
	});

	test("a message that arrives already expired keeps no text", async () => {
		const store = new RecordingStore();
		const backend = new FakeBackend();
		const session = createSession({ store, backend, clock: () => 10_000 });

		backend.emit({
			kind: "message",
			message: {
				...message(),
				id: "m1",
				conversationId: DIRECT_ID,
				sentAt: 1_000,
				body: "stale before it landed",
				expiresAt: 5_000,
			},
		});
		await session.flush();

		const [stored] = store.messages.get(DIRECT_ID) ?? [];
		expect(stored?.body).toBe("");
		expect(stored?.isExpired).toBe(true);
	});
});
