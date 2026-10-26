import { describe, expect, test } from "bun:test";
import { InMemoryStore } from "../src/adapters/memory/store";
import type { Conversation, Message } from "../src/domain/types";

const conversation: Conversation = {
	id: "c-quotes",
	name: "Alice",
	unreadCount: 0,
	lastActivityAt: 1_000,
};

const message = (overrides: Partial<Message> = {}): Message => ({
	id: "c-quotes:1000",
	conversationId: "c-quotes",
	author: "Alice",
	authorId: "uuid-alice",
	body: "second message",
	sentAt: 1_000,
	isOutgoing: false,
	isDeleted: false,
	...overrides,
});

const seeded = async (): Promise<InMemoryStore> => {
	const store = new InMemoryStore();
	await store.upsertConversation(conversation);
	return store;
};

const byId = async (store: InMemoryStore, id: string): Promise<Message | undefined> =>
	(await store.listMessages("c-quotes")).find((entry) => entry.id === id);

/**
 * The same rules as the SQLite adapter, in the same commit: this store is what demo mode
 * and half the suite run against, and an invariant that only one adapter has is an
 * invariant half the app can break.
 */
describe("InMemoryStore quotes", () => {
	test("keeps the identity of the quoted message", async () => {
		const store = await seeded();
		await store.saveMessage(message({ quote: { sentAt: 500, authorId: "uuid-alice" } }));

		expect((await byId(store, "c-quotes:1000"))?.quote).toEqual({
			sentAt: 500,
			authorId: "uuid-alice",
		});
	});

	test("a replay without a quote carries the stored one forward", async () => {
		const store = await seeded();
		await store.saveMessage(message({ quote: { sentAt: 500, authorId: "uuid-alice" } }));
		// The fifth field to fail this way, so it gets its own test: spreading the payload
		// over the stored row erases whatever it omits.
		await store.saveMessage(message());

		expect((await byId(store, "c-quotes:1000"))?.quote).toEqual({
			sentAt: 500,
			authorId: "uuid-alice",
		});
	});

	test("a reply that arrives after its target keeps its marker", async () => {
		// A quote can be resolved before the message it names is in the cache; the marker
		// is what lets the pane resolve it later.
		const store = await seeded();
		await store.saveMessage(message({ quote: { sentAt: 400, authorId: null } }));
		await store.saveMessage(
			message({ id: "c-quotes:400", sentAt: 400, body: "the original", author: "Marta" }),
		);

		const [first] = await store.listMessages("c-quotes");
		expect(first?.quote).toEqual({ sentAt: 400, authorId: null });
	});

	test("a deleted message keeps no quote of its own body but keeps the marker", async () => {
		const store = await seeded();
		await store.saveMessage(message({ quote: { sentAt: 500, authorId: null } }));
		await store.markMessageDeleted("c-quotes", "c-quotes:1000");

		const stored = await byId(store, "c-quotes:1000");
		expect(stored?.isDeleted).toBe(true);
		expect(stored?.quote).toEqual({ sentAt: 500, authorId: null });
	});

	test("an expired message keeps the marker too", async () => {
		const store = await seeded();
		await store.saveMessage(message({ quote: { sentAt: 500, authorId: null }, expiresAt: 2_000 }));
		await store.purgeExpired(3_000);

		const stored = await byId(store, "c-quotes:1000");
		expect(stored?.body).toBe("");
		expect(stored?.quote).toEqual({ sentAt: 500, authorId: null });
	});
});
