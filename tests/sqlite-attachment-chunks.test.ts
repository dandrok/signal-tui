import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { loadAttachments, replaceAttachments } from "../src/adapters/sqlite/attachments";
import { migrations } from "../src/adapters/sqlite/migrations";
import type { Attachment, Message } from "../src/domain/types";

const attachment = (id: string): Attachment => ({
	id,
	contentType: "image/png",
	filename: `/tmp/${id}.png`,
	size: 10,
	caption: null,
	isVoiceNote: false,
});

const message = (id: string): Message => ({
	id,
	conversationId: "c1",
	author: "Alice",
	body: "",
	sentAt: 1,
	isOutgoing: false,
	isDeleted: false,
	attachments: [attachment(`${id}-a`), attachment(`${id}-b`)],
});

/** A real schema without going through the store, so the chunk loop can be driven. */
const freshDb = (): Database => {
	const db = new Database(":memory:", { create: true });
	db.exec("PRAGMA foreign_keys = ON;");
	for (const migration of migrations) {
		db.exec(migration.sql);
	}
	db.exec(
		"INSERT INTO conversations (id, name, unread_count, last_activity_at) VALUES ('c1', 'Alice', 0, 1)",
	);
	return db;
};

const persist = (db: Database, ids: readonly string[]): void => {
	const insert = db.query<null, [string]>(`INSERT INTO messages
		(id, conversation_id, author, body, sent_at, is_outgoing, is_deleted)
		VALUES (?1, 'c1', 'Alice', '', 1, 0, 0)`);
	for (const id of ids) {
		insert.run(id);
		replaceAttachments(db, message(id));
	}
};

describe("loadAttachments", () => {
	test("returns nothing for an empty page", () => {
		const db = freshDb();

		expect(loadAttachments(db, [])).toEqual(new Map());
	});

	test("answers across several chunks without losing or reordering files", () => {
		const db = freshDb();
		const ids = ["m1", "m2", "m3", "m4", "m5"];
		persist(db, ids);

		// chunkSize 2 forces three queries; without the loop this is one oversized IN.
		const loaded = loadAttachments(db, ids, 2);

		expect([...loaded.keys()].sort()).toEqual(ids);
		for (const id of ids) {
			expect(loaded.get(id)?.map((entry) => entry.id)).toEqual([`${id}-a`, `${id}-b`]);
		}
	});

	test("handles a page that straddles a chunk boundary exactly", () => {
		const db = freshDb();
		const ids = ["m1", "m2", "m3", "m4"];
		persist(db, ids);

		const loaded = loadAttachments(db, ids, 2);

		expect(loaded.size).toBe(4);
		expect(loaded.get("m4")?.map((entry) => entry.size)).toEqual([10, 10]);
	});
});
