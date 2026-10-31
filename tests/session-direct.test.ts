import { describe, expect, test } from "bun:test";
import { createSession } from "../src/app/session";
import type { Conversation } from "../src/domain/types";
import { conversation, FakeBackend, RecordingStore } from "./helpers/session-fakes";

/**
 * Opening a chat. Nothing is sent — Signal has no "create a conversation", so the thread is a
 * cache row and the first message is what makes it real.
 *
 * The row's activity time is the part that is easy to get wrong: it is what orders the list, and
 * `upsertConversation` keeps the later of the two times, so dating an old conversation `now` would
 * lift it to the top every time someone re-opened it, as if a message had just arrived.
 */

const ALICE = "uuid-alice";
const CLOCK = 5_000;

/** A store whose first conversation read throws: a cache can be unreadable, not just empty. */
class UnreadableStore extends RecordingStore {
	private reads = 0;

	override async listConversations(): Promise<readonly Conversation[]> {
		this.reads += 1;
		if (this.reads === 1) {
			throw new Error("cache unreadable");
		}
		return super.listConversations();
	}
}

describe("createSession starting a direct conversation", () => {
	test("an existing thread keeps the activity time it already had", async () => {
		const store = new RecordingStore();
		store.conversations = [conversation(ALICE)];
		const session = createSession({ store, backend: new FakeBackend(), clock: () => CLOCK });

		await session.startDirect(ALICE, "Alice");
		await session.flush();

		expect(store.upserted.map((entry) => entry.lastActivityAt)).toEqual([10]);
	});

	test("a thread nobody has written in is dated now", async () => {
		const store = new RecordingStore();
		const session = createSession({ store, backend: new FakeBackend(), clock: () => CLOCK });

		await session.startDirect("uuid-zosia", "Zosia");
		await session.flush();

		expect(store.upserted).toEqual([
			{ id: "uuid-zosia", name: "Zosia", unreadCount: 0, lastActivityAt: CLOCK },
		]);
	});

	test("a read that fails fails the open, and the queue still runs afterwards", async () => {
		// The picker reports what the write did, so a lookup that threw has to reach it instead of
		// being swallowed into a "conversation with Alice" that was never written.
		const store = new UnreadableStore();
		const session = createSession({ store, backend: new FakeBackend(), clock: () => CLOCK });

		await expect(session.startDirect(ALICE, "Alice")).rejects.toThrow("cache unreadable");

		// A failed write is not a stopped queue: the next one still runs.
		await session.startDirect("uuid-zosia", "Zosia");
		await session.flush();
		expect(store.upserted.map((entry) => entry.id)).toEqual(["uuid-zosia"]);
	});
});
