import { describe, expect, test } from "bun:test";
import { createDemoBackend } from "../src/adapters/memory/demo-backend";
import { InMemoryStore } from "../src/adapters/memory/store";
import { createSession } from "../src/app/session";
import type { Message } from "../src/domain/types";

/**
 * The demo's answer is scheduled, so the tests drive the clock instead of sleeping: `schedule`
 * queues the work and `drain` runs it in the order it was queued, which is the order the delays
 * ask for.
 */
function manualSchedule() {
	const queued: Array<{ work: () => void; delayMs: number }> = [];
	const cancelled: number[] = [];
	const schedule = (work: () => void, delayMs: number): (() => void) => {
		const entry = { work, delayMs };
		queued.push(entry);
		return () => {
			cancelled.push(queued.indexOf(entry));
		};
	};
	const drain = (): number[] => {
		const delays: number[] = [];
		for (let entry = queued.shift(); entry !== undefined; entry = queued.shift()) {
			delays.push(entry.delayMs);
			entry.work();
		}
		return delays;
	};
	return { schedule, drain, cancelled, queued };
}

async function bodies(store: InMemoryStore, conversationId: string): Promise<string[]> {
	const rows = await store.listAllMessages(conversationId);
	return rows.map((message: Message) => message.body);
}

describe("the demo backend", () => {
	test("a send is echoed into the cache and the thread answers it", async () => {
		const clock = manualSchedule();
		const store = new InMemoryStore();
		const session = createSession({
			store,
			backend: createDemoBackend({ schedule: clock.schedule }),
		});
		await session.start();

		await session.send("c-alice", "shipping the fix now");
		await session.flush();

		// The echo is the session's write, not the backend's: it is on screen before anything
		// has been answered, which is what a live send looks like.
		expect(await bodies(store, "c-alice")).toContain("shipping the fix now");
		expect(session.typingIn("c-alice")).toBeNull();

		// Typing first, then the line: the notice is the only part that never reaches the cache.
		clock.drain();
		expect(session.typingIn("c-alice")).toBe("Alice");
		await session.flush();
		expect(await bodies(store, "c-alice")).toContain(
			"yep, the audio routing test passed this morning",
		);

		// The answer is a stored incoming row, so it survives the read the pane does.
		const incoming = (await store.listAllMessages("c-alice")).filter(
			(message) => message.author === "Alice" && !message.isOutgoing,
		);
		expect(incoming.length).toBe(2);
		await session.stop();
	});

	test("the scripted answer is a real incoming message, so it notifies", async () => {
		const clock = manualSchedule();
		const store = new InMemoryStore();
		const session = createSession({
			store,
			backend: createDemoBackend({ schedule: clock.schedule }),
		});
		const seen: string[] = [];
		const stop = session.onIncoming((notice) => seen.push(notice.message.body));
		await session.start();

		await session.send("c-family", "on my way");
		clock.drain();
		await session.flush();

		expect(seen).toEqual(["perfect, see you at 7"]);
		stop();
		await session.stop();
	});

	test("nobody answers a note to yourself", async () => {
		const clock = manualSchedule();
		const store = new InMemoryStore();
		const session = createSession({
			store,
			backend: createDemoBackend({ schedule: clock.schedule }),
		});
		await session.start();

		await session.send("c-note-to-self", "remember the FTS index");
		await session.flush();
		expect(clock.drain()).toEqual([]);
		expect(await bodies(store, "c-note-to-self")).toContain("remember the FTS index");
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

	test("stop cancels an answer that has not been written yet", async () => {
		const clock = manualSchedule();
		const session = createSession({
			store: new InMemoryStore(),
			backend: createDemoBackend({ schedule: clock.schedule }),
		});
		await session.start();

		await session.send("c-alice", "hello");
		await session.stop();

		expect(clock.cancelled.length).toBe(2);
	});
});
