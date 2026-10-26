import { describe, expect, test } from "bun:test";
import { createSession } from "../src/app/session";
import { conversation, FakeBackend, message, RecordingStore } from "./helpers/session-fakes";

/**
 * What counts as "a message arrived". The notification is only as good as this event: a
 * toast for a message the cache refused to keep, or one for a replayed envelope after a
 * reconnect, is the sort of noise that gets a feature switched off.
 */
describe("createSession incoming notices", () => {
	test("announces a message that was newly stored", async () => {
		const store = new RecordingStore();
		const backend = new FakeBackend();
		const session = createSession({ store, backend });
		const seen: string[] = [];
		session.onIncoming((notice) => seen.push(`${notice.conversationName}:${notice.message.body}`));

		backend.emit({ kind: "conversation-updated", conversation: conversation() });
		backend.emit({ kind: "message", message: message("m1") });
		await session.flush();

		expect(seen).toEqual(["Alice:hi"]);
	});

	test("says nothing about our own message", async () => {
		const store = new RecordingStore();
		const backend = new FakeBackend();
		const session = createSession({ store, backend });
		const seen: string[] = [];
		session.onIncoming((notice) => seen.push(notice.message.id));

		backend.emit({ kind: "message", message: { ...message("m1"), isOutgoing: true } });
		await session.flush();

		expect(seen).toEqual([]);
	});

	test("says nothing about a replayed envelope", async () => {
		const store = new RecordingStore();
		const backend = new FakeBackend();
		const session = createSession({ store, backend });
		const seen: string[] = [];
		session.onIncoming((notice) => seen.push(notice.message.id));

		backend.emit({ kind: "message", message: message("m1") });
		backend.emit({ kind: "message", message: message("m1") });
		await session.flush();

		expect(seen).toEqual(["m1"]);
	});

	test("names the thread from the update that arrived before the message", async () => {
		// The backend emits `conversation-updated` first; asking the store inside the queue
		// would put a read in front of every write.
		const store = new RecordingStore();
		const backend = new FakeBackend();
		const session = createSession({ store, backend });
		let name = "unset";
		session.onIncoming((notice) => {
			name = notice.conversationName;
		});

		backend.emit({ kind: "conversation-updated", conversation: conversation() });
		backend.emit({ kind: "message", message: message("m1") });
		await session.flush();

		expect(name).toBe("Alice");
	});

	test("an empty update name does not erase the one already known", async () => {
		// A sync transcript carries only the destination id: its update says nothing about
		// the name, and a notification must not lose it.
		const store = new RecordingStore();
		const backend = new FakeBackend();
		const session = createSession({ store, backend });
		const names: string[] = [];
		session.onIncoming((notice) => names.push(notice.conversationName));

		backend.emit({ kind: "conversation-updated", conversation: conversation() });
		backend.emit({
			kind: "conversation-updated",
			conversation: { ...conversation(), name: "" },
		});
		backend.emit({ kind: "message", message: message("m1") });
		await session.flush();

		expect(names).toEqual(["Alice"]);
	});

	test("a listener can unsubscribe", async () => {
		const store = new RecordingStore();
		const backend = new FakeBackend();
		const session = createSession({ store, backend });
		const seen: string[] = [];
		const stop = session.onIncoming((notice) => seen.push(notice.message.id));

		stop();
		backend.emit({ kind: "message", message: message("m1") });
		await session.flush();

		expect(seen).toEqual([]);
	});
});
