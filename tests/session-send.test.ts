import { describe, expect, test } from "bun:test";
import { createSession } from "../src/app/session";
import { SELF_AUTHOR_ID } from "../src/domain/types";
import { DIRECT_ID, FakeBackend, RecordingStore } from "./helpers/session-fakes";

/** Sending: what goes to the backend, and what the store is told afterwards. */
describe("createSession sending", () => {
	test("sends through the backend", async () => {
		const store = new RecordingStore();
		const backend = new FakeBackend();
		const session = createSession({ store, backend });

		await session.send("uuid-alice", "hello");

		expect(backend.sent).toEqual([{ conversationId: "uuid-alice", body: "hello" }]);
	});

	test("echoes a sent message into the store so it appears immediately", async () => {
		const store = new RecordingStore();
		const backend = new FakeBackend();
		const session = createSession({ store, backend });
		let changes = 0;
		session.onChange(() => {
			changes++;
		});

		await session.send("uuid-alice", "hello");

		expect(backend.sent).toEqual([{ conversationId: "uuid-alice", body: "hello" }]);
		expect(store.ops).toHaveLength(2);
		expect(store.ops[0]).toBe("conversation:uuid-alice");
		expect(store.ops).not.toContain("unread+1:uuid-alice");
		// the server timestamp, not a local clock reading: deletes refer to it
		expect(store.ops[1]).toBe("message:uuid-alice:1760000000500");
		expect(changes).toBe(1);
	});

	test("does not echo a message the backend refused to send", async () => {
		const store = new RecordingStore();
		const backend = new FakeBackend();
		backend.sendMessage = async () => {
			throw new Error("network down");
		};
		const session = createSession({ store, backend });

		await expect(session.send("uuid-alice", "hello")).rejects.toThrow("network down");

		expect(store.ops).toEqual([]);
	});

	test("a sent message records whose it is", async () => {
		const store = new RecordingStore();
		const backend = new FakeBackend();
		const session = createSession({ store, backend });

		await session.send(DIRECT_ID, "hello from here");
		await session.flush();

		const [saved] = store.savedMessages;
		// Without an id the row would only match edits by the label "You", which a peer
		// in a group can adopt for itself.
		expect(saved?.authorId).toBe("self");
		expect(saved?.author).toBe("You");
	});

	test("a sent message inherits the conversation's disappearing timer", async () => {
		const store = new RecordingStore();
		const backend = new FakeBackend();
		store.timers.set(DIRECT_ID, 3_600);
		const session = createSession({ store, backend, clock: () => 1_000 });

		await session.send(DIRECT_ID, "gone in an hour");
		await session.flush();

		const [saved] = store.messages.get(DIRECT_ID) ?? [];
		// Relative to the timestamp the backend actually used, not to the test clock.
		expect(saved?.expiresAt).toBe((saved?.sentAt ?? 0) + 3_600_000);
	});

	test("a conversation without a timer leaves the message alone", async () => {
		const store = new RecordingStore();
		const backend = new FakeBackend();
		store.timers.set(DIRECT_ID, 0);
		const session = createSession({ store, backend, clock: () => 1_000 });

		await session.send(DIRECT_ID, "kept");
		await session.flush();

		const [saved] = store.messages.get(DIRECT_ID) ?? [];
		expect(saved?.expiresAt).toBeUndefined();
	});

	test("a reply hands the backend the message it answers", async () => {
		const store = new RecordingStore();
		const backend = new FakeBackend();
		const session = createSession({ store, backend });

		await session.send(DIRECT_ID, "agreed", {
			sentAt: 10,
			authorId: "uuid-marta",
			text: "attachments path also needs the 4 MiB limit",
		});

		expect(backend.sent.at(-1)?.replyTo).toEqual({
			sentAt: 10,
			authorId: "uuid-marta",
			text: "attachments path also needs the 4 MiB limit",
		});
	});

	test("our own reply echoes with the marker, so it draws what it answers", async () => {
		// Signal never sends the transcript back to the device that wrote the message, so
		// without the marker our own reply would show no quote until another device echoed it.
		const store = new RecordingStore();
		const backend = new FakeBackend();
		const session = createSession({ store, backend, clock: () => 1_000 });

		await session.send(DIRECT_ID, "adding to that", {
			sentAt: 10,
			authorId: SELF_AUTHOR_ID,
			text: "on it, testing now",
		});
		await session.flush();

		const [saved] = store.messages.get(DIRECT_ID) ?? [];
		expect(saved?.isOutgoing).toBe(true);
		// Only the identity: the quoted text is read from the message it names.
		expect(saved?.quote).toEqual({ sentAt: 10, authorId: SELF_AUTHOR_ID });
	});

	test("a plain message carries no marker", async () => {
		const store = new RecordingStore();
		const backend = new FakeBackend();
		const session = createSession({ store, backend });

		await session.send(DIRECT_ID, "hello");
		await session.flush();

		const [saved] = store.messages.get(DIRECT_ID) ?? [];
		expect(saved?.quote).toBeUndefined();
	});
});
