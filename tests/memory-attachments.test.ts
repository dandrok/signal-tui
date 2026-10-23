import { describe, expect, test } from "bun:test";
import { InMemoryStore } from "../src/adapters/memory/store";
import type { Message } from "../src/domain/types";

const withFiles: Message = {
	id: "m-files",
	conversationId: "c-signal-devs",
	author: "Marta",
	body: "",
	sentAt: 9_999,
	isOutgoing: false,
	isDeleted: false,
	attachments: [
		{
			id: "a1",
			contentType: "image/png",
			filename: "/tmp/attachments/photo.png",
			size: 2_048,
			caption: "look",
			isVoiceNote: false,
		},
	],
};

describe("InMemoryStore attachments", () => {
	test("returns the files it stored", async () => {
		const store = new InMemoryStore();
		await store.saveMessage(withFiles);

		const stored = (await store.listMessages("c-signal-devs")).find(
			(message) => message.id === "m-files",
		);

		expect(stored?.attachments).toEqual(withFiles.attachments);
	});

	test("reports an empty list rather than a missing field", async () => {
		const store = new InMemoryStore();
		// Saved without the field at all, the way an adapter that only maps text would.
		const { attachments, ...textOnly } = withFiles;
		await store.saveMessage({ ...textOnly, id: "m-plain" });

		const stored = (await store.listMessages("c-signal-devs")).find(
			(message) => message.id === "m-plain",
		);

		expect(stored?.attachments).toEqual([]);
	});

	test("keeps files when an update says nothing about them", async () => {
		const store = new InMemoryStore();
		await store.saveMessage(withFiles);

		// A partial update (an edit, say) that carries no attachments field must not
		// be read as "this message lost its files".
		const { attachments, ...withoutFiles } = withFiles;
		await store.saveMessage({ ...withoutFiles, body: "edited" });

		const stored = (await store.listMessages("c-signal-devs")).find(
			(message) => message.id === "m-files",
		);

		expect(stored?.body).toBe("edited");
		expect(stored?.attachments).toEqual(withFiles.attachments);
	});

	test("drops them when the message is deleted", async () => {
		const store = new InMemoryStore();
		await store.saveMessage(withFiles);
		await store.markMessageDeleted("c-signal-devs", "m-files");

		const stored = (await store.listMessages("c-signal-devs")).find(
			(message) => message.id === "m-files",
		);

		expect(stored?.attachments).toEqual([]);
	});
});
