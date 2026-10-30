import { describe, expect, test } from "bun:test";
import { createDemoBackend } from "../src/adapters/memory/demo-backend";
import { InMemoryStore } from "../src/adapters/memory/store";
import { createSession } from "../src/app/session";
import type { Message } from "../src/domain/types";

/**
 * The demo's answer is scheduled, so the tests drive the clock instead of sleeping: `schedule`
 * queues the work, `drain` runs it in the order it was queued, and a cancelled entry is skipped
 * the way a cleared timer would be — otherwise "stop cancels" would pass on a no-op.
 */
function manualSchedule() {
	const queued: Array<{ work: () => void; delayMs: number; cancelled: boolean }> = [];
	const schedule = (work: () => void, delayMs: number): (() => void) => {
		const entry = { work, delayMs, cancelled: false };
		queued.push(entry);
		return () => {
			entry.cancelled = true;
		};
	};
	/** Runs up to `count` pending entries and answers the delays it actually ran. */
	const drain = (count = Number.MAX_SAFE_INTEGER): number[] => {
		const delays: number[] = [];
		while (delays.length < count) {
			const entry = queued.shift();
			if (entry === undefined) {
				break;
			}
			if (entry.cancelled) {
				continue;
			}
			delays.push(entry.delayMs);
			entry.work();
		}
		return delays;
	};
	return { schedule, drain };
}

/** Through a real session and a real store: the demo path, not the backend alone. */
async function demoSession() {
	const clock = manualSchedule();
	const store = new InMemoryStore();
	const session = createSession({
		store,
		backend: createDemoBackend({ schedule: clock.schedule }),
	});
	await session.start();
	const bodies = async (conversationId: string): Promise<string[]> => {
		const rows = await store.listAllMessages(conversationId);
		return rows.map((message: Message) => message.body);
	};
	return { clock, store, session, bodies };
}

describe("the demo backend", () => {
	test("a send is echoed into the cache before anything is answered", async () => {
		const { session, bodies } = await demoSession();

		await session.send("c-alice", "shipping the fix now");
		await session.flush();

		// The echo is the session's write, not the answer's: it is on screen first, which is
		// what a live send looks like.
		expect(await bodies("c-alice")).toContain("shipping the fix now");
		expect(session.typingIn("c-alice")).toBeNull();
		await session.stop();
	});

	test("the thread types, then answers, and stops typing when it does", async () => {
		const { clock, session, bodies } = await demoSession();

		await session.send("c-alice", "shipping the fix now");
		// One entry at a time: the notice has to be visible before the answer lands, and gone
		// once it has.
		expect(clock.drain(1)).toEqual([600]);
		expect(session.typingIn("c-alice")).toBe("Alice");

		clock.drain();
		await session.flush();
		expect(await bodies("c-alice")).toContain("yep, the audio routing test passed this morning");
		expect(session.typingIn("c-alice")).toBeNull();
		await session.stop();
	});

	test("the answer arrives as a named incoming thread, so a toast can name it", async () => {
		const { clock, session } = await demoSession();
		const seen: Array<{ body: string; name: string }> = [];
		const stop = session.onIncoming((notice) =>
			seen.push({ body: notice.message.body, name: notice.conversationName }),
		);

		await session.send("c-family", "on my way");
		clock.drain();
		await session.flush();

		// The name is the group's, not the sender's: `Mum` without `Family` names nobody.
		expect(seen).toEqual([{ body: "perfect, see you at 7", name: "Family" }]);
		stop();
		await session.stop();
	});

	test("nobody answers a note to yourself", async () => {
		const { clock, session, bodies } = await demoSession();

		await session.send("c-note-to-self", "remember the FTS index");
		await session.flush();
		expect(clock.drain()).toEqual([]);
		expect(await bodies("c-note-to-self")).toContain("remember the FTS index");
		await session.stop();
	});

	test("two sends in one millisecond keep their own identity", async () => {
		const clock = manualSchedule();
		const store = new InMemoryStore();
		const session = createSession({
			store,
			backend: createDemoBackend({ schedule: clock.schedule, now: () => 1_000 }),
		});
		await session.start();

		await session.send("c-note-to-self", "first");
		await session.send("c-note-to-self", "second");
		await session.flush();

		const sent = (await store.listAllMessages("c-note-to-self")).filter((message) =>
			["first", "second"].includes(message.body),
		);
		// One instant is one row: without the tie-break the second send overwrites the first.
		expect(sent.length).toBe(2);
		expect(new Set(sent.map((message) => message.sentAt)).size).toBe(2);
		await session.stop();
	});

	test("an answer moves its thread back to the top of the list", async () => {
		const clock = manualSchedule();
		// An hour after the seed's last row, so the two sends really are the newest activity —
		// a small synthetic clock would sit in the past and lose to every seeded thread.
		const base = Date.parse("2026-10-22T11:00:00Z");
		let now = base;
		const store = new InMemoryStore();
		const session = createSession({
			store,
			backend: createDemoBackend({ schedule: clock.schedule, now: () => now }),
		});
		await session.start();

		// Two threads written in a row: the second is on top, and the first is owed an answer.
		await session.send("c-alice", "shipping the fix now");
		now = base + 1_000;
		await session.send("c-family", "on my way");
		await session.flush();
		expect((await store.listConversations())[0]?.id).toBe("c-family");

		now = base + 2_000;
		// Alice's typing notice and her answer, and nothing from the family thread yet.
		clock.drain(2);
		await session.flush();

		// The answer is the newest thing in the cache, so its thread belongs above the one that
		// only looks newer: the seed's own activity time is in the past and cannot say that.
		expect((await store.listConversations())[0]?.id).toBe("c-alice");
		await session.stop();
	});

	test("stop drops the answer instead of leaving it to fire later", async () => {
		const clock = manualSchedule();
		const backend = createDemoBackend({ schedule: clock.schedule });
		const emitted: string[] = [];
		const unsubscribe = backend.subscribe((event) => emitted.push(event.kind));

		await backend.sendMessage("c-alice", "hello");
		await backend.stop();
		clock.drain();

		// Nothing ran and nothing was said: quitting mid-reply leaves no timer behind.
		expect(emitted).toEqual([]);
		unsubscribe();
	});
});
