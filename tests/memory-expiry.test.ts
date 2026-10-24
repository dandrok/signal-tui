import { describe, expect, test } from "bun:test";
import { InMemoryStore } from "../src/adapters/memory/store";

const conversation = () => ({
	id: "uuid-x",
	name: "Alice",
	unreadCount: 0,
	lastActivityAt: 1_000,
});

describe("InMemoryStore expiry", () => {
	test("clears the body and files of a message whose timer ran out", async () => {
		const store = new InMemoryStore();
		await store.upsertConversation(conversation());
		await store.saveMessage({
			id: "m1",
			conversationId: "uuid-x",
			author: "Alice",
			body: "this will vanish",
			sentAt: 1_000,
			isOutgoing: false,
			isDeleted: false,
			expiresAt: 2_000,
			attachments: [
				{
					id: "a1",
					contentType: "image/png",
					filename: "x.png",
					size: 1,
					caption: null,
					isVoiceNote: false,
				},
			],
		});

		expect(await store.purgeExpired(2_000)).toBe(1);

		const [purged] = await store.listMessages("uuid-x");
		expect(purged?.body).toBe("");
		expect(purged?.isExpired).toBe(true);
		expect(purged?.attachments).toEqual([]);
		expect(await store.search("vanish")).toHaveLength(0);
	});

	test("counts nothing twice, ignores messages without a timer, refuses a late edit", async () => {
		const store = new InMemoryStore();
		await store.upsertConversation(conversation());
		await store.saveMessage({
			id: "m1",
			conversationId: "uuid-x",
			author: "Alice",
			body: "timed",
			sentAt: 1_000,
			isOutgoing: false,
			isDeleted: false,
			expiresAt: 2_000,
		});
		await store.saveMessage({
			id: "m2",
			conversationId: "uuid-x",
			author: "Alice",
			body: "forever",
			sentAt: 1_500,
			isOutgoing: false,
			isDeleted: false,
		});

		expect(await store.purgeExpired(2_000)).toBe(1);
		expect(await store.purgeExpired(2_000)).toBe(0);
		const saved = await store.listMessages("uuid-x");
		expect(saved.find((entry) => entry.id === "m2")?.body).toBe("forever");

		// the timer took the text away; a late edit does not bring it back
		expect(await store.applyEdit("uuid-x", 1_000, { id: "uuid-x", label: "Alice" }, "back")).toBe(
			false,
		);
		expect((await store.listMessages("uuid-x")).find((e) => e.id === "m1")?.body).toBe("");
	});
});

describe("InMemoryStore replay after expiry", () => {
	test("a replay does not refill a message the timer emptied", async () => {
		const store = new InMemoryStore();
		await store.upsertConversation(conversation());
		const original = {
			id: "m1",
			conversationId: "uuid-x",
			author: "Alice",
			body: "gone in an hour",
			sentAt: 1_000,
			isOutgoing: false,
			isDeleted: false,
			expiresAt: 2_000,
			attachments: [
				{
					id: "a1",
					contentType: "image/png",
					filename: "x.png",
					size: 1,
					caption: null,
					isVoiceNote: false,
				},
			],
		};
		await store.saveMessage(original);
		await store.purgeExpired(2_500);
		await store.saveMessage(original);

		const [replayed] = await store.listMessages("uuid-x");
		expect(replayed?.body).toBe("");
		expect(replayed?.attachments).toEqual([]);
		expect(replayed?.isExpired).toBe(true);
		expect(await store.purgeExpired(9_000)).toBe(0);
	});
});

describe("InMemoryStore deadline on replay", () => {
	const saved = (overrides: Record<string, unknown> = {}) => ({
		id: "m1",
		conversationId: "uuid-x",
		author: "Alice",
		body: "gone at 2s",
		sentAt: 1_000,
		isOutgoing: false,
		isDeleted: false,
		...overrides,
	});

	test("a replay without a deadline keeps the stored one", async () => {
		const store = new InMemoryStore();
		await store.upsertConversation(conversation());
		await store.saveMessage(saved({ expiresAt: 2_000 }));

		// Signal omits expiresInSeconds when there is nothing to say about it.
		await store.saveMessage(saved());

		expect((await store.listMessages("uuid-x"))[0]?.expiresAt).toBe(2_000);
		expect(await store.purgeExpired(3_000)).toBe(1);
	});

	test("a later deadline does not push out the stored one", async () => {
		const store = new InMemoryStore();
		await store.upsertConversation(conversation());
		await store.saveMessage(saved({ expiresAt: 2_000 }));
		await store.saveMessage(saved({ expiresAt: 9_000_000 }));

		expect((await store.listMessages("uuid-x"))[0]?.expiresAt).toBe(2_000);
	});

	test("a deadline that was never known can be filled", async () => {
		const store = new InMemoryStore();
		await store.upsertConversation(conversation());
		await store.saveMessage(saved());
		await store.saveMessage(saved({ expiresAt: 5_000 }));

		expect((await store.listMessages("uuid-x"))[0]?.expiresAt).toBe(5_000);
	});
});
