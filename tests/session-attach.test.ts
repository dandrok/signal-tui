import { describe, expect, test } from "bun:test";
import { createSession } from "../src/app/session";
import { FakeBackend, RecordingStore } from "./helpers/session-fakes";

/**
 * Sending a file is a send with two differences: the path goes to the engine, and the local echo
 * has to carry the file — the engine never echoes a send back, so nothing else would tell the
 * pane that the message it just wrote has a photo attached.
 */

const CONVERSATION = "uuid-amber";
const FILE = { path: "/home/me/photos/cat.jpg", name: "cat.jpg", size: 40 };

describe("createSession attaching a file", () => {
	test("the path reaches the engine, and the echo keeps it as the attachment", async () => {
		const store = new RecordingStore();
		const backend = new FakeBackend();
		const session = createSession({ store, backend });

		await session.send(CONVERSATION, "", undefined, FILE);
		await session.flush();

		expect(backend.sent).toEqual([{ conversationId: CONVERSATION, body: "", filePath: FILE.path }]);
		const [saved] = store.savedMessages;
		expect(saved?.attachments).toEqual([
			{
				id: null,
				contentType: null,
				// The path, not the name: the pane splits it for display, and a later `o` needs
				// the path the engine would read.
				filename: FILE.path,
				size: FILE.size,
				caption: null,
				isVoiceNote: false,
			},
		]);
		// An empty body is allowed, and the row says so rather than pretending otherwise.
		expect(saved?.body).toBe("");
	});

	test("a plain send keeps no attachments at all", async () => {
		// Not an empty list: a row that was never given files must not claim to have an empty set.
		const store = new RecordingStore();
		const session = createSession({ store, backend: new FakeBackend() });

		await session.send(CONVERSATION, "hello");
		await session.flush();

		expect(store.savedMessages[0]?.attachments).toBeUndefined();
	});
});
