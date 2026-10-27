import { expect, test } from "bun:test";
import { InMemoryStore } from "../src/adapters/memory/store";
import { SqliteMessageStore } from "../src/adapters/sqlite/store";
import type { ConversationId, Message } from "../src/domain/types";
import type { MessageStore } from "../src/ports/store";

/**
 * One script, two adapters, the same observation after every step.
 *
 * The suites that came before this were written twice — `memory-edits.test.ts` beside
 * `sqlite-edits.test.ts`, and so on — so "both stores agree" was a claim maintained by hand.
 * This states it once: every step runs against both adapters and must produce the same state
 * *and* the same return values, because the booleans are a contract too ("nothing changed, so
 * nothing redraws"), and a store that reports a change it did not make is a redraw loop.
 *
 * It is also the test this refactor was for: the rules now live in `sqlite/message-rules.ts`
 * and `memory/message-rules.ts`, and nothing but this stops them drifting apart.
 *
 * One rule per step, and each step leaves the state in a shape that exposes the rule it
 * exercises — a step that ends where it started proves nothing.
 */

const DIRECT: ConversationId = "+48123456789";
const AMBER = { id: "uuid-amber", label: "Amber" };
const NOW = 10_000;

const adapters = [
	{ name: "sqlite", open: (): MessageStore => new SqliteMessageStore({ path: ":memory:" }) },
	{ name: "memory", open: (): MessageStore => new InMemoryStore({ seed: false }) },
] as const;

const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value ?? null));

/** Everything the cache can be asked, in a shape both adapters must produce byte for byte. */
async function state(store: MessageStore): Promise<unknown> {
	const thread = await store.listMessages(DIRECT, 50);
	// Search is the one place the engines answer in a different order: FTS5 ranks by relevance,
	// the memory store keeps insertion order. The set is the contract, the order is the
	// engine's, so results are compared sorted — `thread` and `all` stay exact.
	const found = [...(await store.search("hello", 20))].sort((a, b) => (a.id < b.id ? -1 : 1));
	return plain({
		conversations: await store.listConversations(),
		thread,
		all: await store.listAllMessages(DIRECT),
		// A page of two, because a limited read is where insertion order and send order stop
		// agreeing: the wrong rows or the wrong sequence both show up here and nowhere else.
		page: await store.listMessages(DIRECT, 2),
		found,
		timer: await store.expiresInSeconds(DIRECT),
	});
}

const incoming = (over: Partial<Message> = {}): Message => ({
	id: `${DIRECT}:1000`,
	conversationId: DIRECT,
	author: "Amber",
	authorId: "uuid-amber",
	body: "hello",
	sentAt: 1000,
	isOutgoing: false,
	isDeleted: false,
	attachments: [],
	...over,
});

const saved = (over: Partial<Message> = {}): Message =>
	incoming({
		id: `${DIRECT}:2000`,
		body: "hello back",
		sentAt: 2000,
		isOutgoing: true,
		author: "You",
		authorId: "self",
		...over,
	});

/** A step returns what it wants compared beyond the state: the store's own answers. */
type Step = readonly [name: string, run: (store: MessageStore) => Promise<unknown>];

const steps: readonly Step[] = [
	[
		"a conversation is created",
		async (store) => {
			await store.upsertConversation({
				id: DIRECT,
				name: "Amber",
				unreadCount: 0,
				lastActivityAt: 1000,
			});
		},
	],
	[
		"an update with an empty name and an older activity changes neither",
		async (store) => {
			await store.upsertConversation({
				id: DIRECT,
				name: "   ",
				unreadCount: 0,
				lastActivityAt: 500,
			});
		},
	],
	[
		"a timer is learned, and an update that omits it keeps it",
		async (store) => {
			await store.upsertConversation({
				id: DIRECT,
				name: "",
				unreadCount: 0,
				lastActivityAt: 2000,
				expiresInSeconds: 3600,
			});
			await store.upsertConversation({
				id: DIRECT,
				name: "",
				unreadCount: 0,
				lastActivityAt: 2500,
			});
		},
	],
	["a message arrives", (store) => store.saveMessage(incoming())],
	[
		"the same envelope replays with a different body, and is not a second row",
		(store) => store.saveMessage(incoming({ body: "hello again" })),
	],
	["our own message is saved", (store) => store.saveMessage(saved())],
	[
		"an older message arrives after a newer one, which is how a sync transcript replays",
		async (store) => {
			await store.saveMessage(
				incoming({ id: `${DIRECT}:5000`, sentAt: 5000, body: "hello latest" }),
			);
			await store.saveMessage(
				incoming({ id: `${DIRECT}:4500`, sentAt: 4500, body: "hello earlier" }),
			);
		},
	],
	[
		"unread accumulates",
		async (store) => {
			await store.incrementUnread(DIRECT, 2);
			await store.incrementUnread(DIRECT, 1);
		},
	],
	[
		"clearing unread reports a change once, then nothing",
		async (store) => [
			await store.markConversationRead(DIRECT),
			await store.markConversationRead(DIRECT),
		],
	],
	[
		"the author edits their own message",
		(store) => store.applyEdit(DIRECT, 1000, AMBER, "hello, edited"),
	],
	[
		"an edit from someone else is refused",
		(store) => store.applyEdit(DIRECT, 1000, { id: "uuid-mallory", label: "Mallory" }, "mine now"),
	],
	[
		"an edit of a message that is not cached is refused",
		(store) => store.applyEdit(DIRECT, 9999, AMBER, "nowhere"),
	],
	[
		"a reaction is added",
		(store) =>
			store.applyReaction(
				DIRECT,
				2000,
				{ emoji: "👍", author: "Amber", authorId: "uuid-amber" },
				false,
			),
	],
	[
		"the same reaction again is not a change",
		(store) =>
			store.applyReaction(
				DIRECT,
				2000,
				{ emoji: "👍", author: "Amber", authorId: "uuid-amber" },
				false,
			),
	],
	[
		"a second emoji from the same person replaces the first",
		(store) =>
			store.applyReaction(
				DIRECT,
				2000,
				{ emoji: "🎉", author: "Amber", authorId: "uuid-amber" },
				false,
			),
	],
	[
		"reactions arrive in the opposite order to the one they are read in",
		async (store) => {
			// 🎉 (from Amber) is already there from the step above; 👍 from a second person is
			// added now, so arrival order and emoji order disagree in both directions.
			await store.applyReaction(
				DIRECT,
				2000,
				{ emoji: "❤️", author: "Bo", authorId: "uuid-bo" },
				false,
			);
		},
	],
	[
		"a second person's reaction sits beside it",
		(store) =>
			store.applyReaction(DIRECT, 2000, { emoji: "👍", author: "You", authorId: "self" }, false),
	],
	[
		"a removal takes one reaction away, and repeating it changes nothing",
		async (store) => [
			await store.applyReaction(
				DIRECT,
				2000,
				{ emoji: "🎉", author: "Amber", authorId: "uuid-amber" },
				true,
			),
			await store.applyReaction(
				DIRECT,
				2000,
				{ emoji: "🎉", author: "Amber", authorId: "uuid-amber" },
				true,
			),
		],
	],
	[
		"a reaction on a message that is not cached changes nothing",
		(store) =>
			store.applyReaction(
				DIRECT,
				9999,
				{ emoji: "👍", author: "Amber", authorId: "uuid-amber" },
				false,
			),
	],
	[
		"a delivered receipt is recorded, and a weaker one arriving late is ignored",
		(store) => store.applyReceipt([2000], "delivered"),
	],
	["a read receipt strengthens it", (store) => store.applyReceipt([2000], "read")],
	[
		"a late delivery receipt does not undo the read",
		(store) => store.applyReceipt([2000], "delivered"),
	],
	[
		"a receipt for a message of theirs changes nothing",
		(store) => store.applyReceipt([1000], "read"),
	],
	[
		"a disappearing message expires and is purged",
		async (store) => {
			await store.saveMessage(incoming({ id: `${DIRECT}:3000`, sentAt: 3000, expiresAt: NOW - 1 }));
			await store.applyReaction(
				DIRECT,
				3000,
				{ emoji: "👍", author: "Amber", authorId: "uuid-amber" },
				false,
			);
		},
	],
	["purging drops its text, files and reactions", (store) => store.purgeExpired(NOW)],
	[
		"an edit that arrives after expiry cannot refill it",
		(store) => store.applyEdit(DIRECT, 3000, AMBER, "too late"),
	],
	[
		"a message is deleted for everyone, and its reactions go with it",
		async (store) => {
			await store.saveMessage(
				incoming({ id: `${DIRECT}:4000`, sentAt: 4000, body: "hello once more" }),
			);
			await store.applyReaction(
				DIRECT,
				4000,
				{ emoji: "👍", author: "Amber", authorId: "uuid-amber" },
				false,
			);
			await store.markMessageDeleted(DIRECT, `${DIRECT}:4000`);
		},
	],
	[
		"a search finds what is left, and an empty needle finds nothing",
		async (store) => [
			(await store.search("hello", 20)).length,
			(await store.search("   ", 20)).length,
			(await store.search("gone", 20)).length,
		],
	],
];

test("the two adapters answer identically, step by step", async () => {
	const stores = adapters.map((adapter) => ({ name: adapter.name, store: adapter.open() }));

	for (const [index, [name, run]] of steps.entries()) {
		const seen: unknown[] = [];
		for (const { store } of stores) {
			const result = plain(await run(store));
			seen.push({ result, state: await state(store) });
		}
		const [first, second] = seen;
		// Compared per step so a failure names the rule that split, and with the same keys on
		// both sides so a naming difference cannot be mistaken for a behavioural one.
		const label = `${index + 1}. ${name}`;
		expect([{ step: label, ...(first as object) }]).toEqual([
			{ step: label, ...(second as object) },
		]);
	}

	for (const { store } of stores) {
		if (store instanceof SqliteMessageStore) {
			store.close();
		}
	}
});
