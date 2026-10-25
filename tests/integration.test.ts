import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonRpcClient } from "../src/adapters/signal/json-rpc-client";
import { createProcessStream } from "../src/adapters/signal/process-stream";
import { SignalCliBackend } from "../src/adapters/signal/signal-cli-backend";
import type { Message } from "../src/domain/types";
import type { BackendEvent } from "../src/ports/backend";

const FAKE_PEER = join(import.meta.dir, "fixtures", "fake-signal-cli.ts");
const ACCOUNT = "+10000000000";

const waitFor = async (predicate: () => boolean, timeoutMs = 3_000): Promise<void> => {
	const deadline = Date.now() + timeoutMs;
	while (!predicate()) {
		if (Date.now() > deadline) {
			throw new Error(`condition not met within ${timeoutMs}ms`);
		}
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
};

describe("signal-cli adapter over a real child process", () => {
	test("receives an envelope and sends a message end to end", async () => {
		const dir = mkdtempSync(join(tmpdir(), "signal-tui-int-"));
		const capture = join(dir, "sends.jsonl");

		const stream = createProcessStream({ command: [process.execPath, FAKE_PEER, capture] });
		const client = new JsonRpcClient(stream, { defaultTimeoutMs: 5_000 });
		const backend = new SignalCliBackend(client, { account: ACCOUNT });

		const messages: Message[] = [];
		const kinds: BackendEvent["kind"][] = [];
		const receipts: Array<{ timestamps: readonly number[]; state: string }> = [];
		const reactions: Array<{ targetSentAt: number; emoji: string; isRemove: boolean }> = [];
		backend.subscribe((event) => {
			kinds.push(event.kind);
			if (event.kind === "message") {
				messages.push(event.message);
			}
			if (event.kind === "receipt") {
				receipts.push({ timestamps: event.timestamps, state: event.state });
			}
			if (event.kind === "reaction") {
				reactions.push({
					targetSentAt: event.targetSentAt,
					emoji: event.emoji,
					isRemove: event.isRemove,
				});
			}
		});

		try {
			await backend.start();
			await waitFor(() => messages.length > 0);

			await waitFor(() => messages.length > 2);

			expect(messages[0]).toEqual({
				id: "uuid-alice:1760000000000",
				conversationId: "uuid-alice",
				author: "Alice",
				authorId: "uuid-alice",
				body: "hello from the fake peer",
				sentAt: 1_760_000_000_000,
				isOutgoing: false,
				isDeleted: false,
				attachments: [],
			});
			// your own message arrives as a sync transcript, not as incoming text
			expect(messages[1]).toEqual({
				id: "uuid-bob:1760000000001",
				conversationId: "uuid-bob",
				author: "You",
				// Our own messages carry a marker no peer can claim, so a peer cannot
				// pass its edit off as an edit of our message.
				authorId: "self",
				body: "sent from my phone",
				sentAt: 1_760_000_000_001,
				isOutgoing: true,
				isDeleted: false,
				attachments: [],
			});
			// A message the sender marked view-once arrives with neither text nor files.
			expect(messages[2]).toEqual({
				id: "uuid-alice:1760000000003",
				conversationId: "uuid-alice",
				author: "Alice",
				authorId: "uuid-alice",
				body: "",
				sentAt: 1_760_000_000_003,
				isOutgoing: false,
				isDeleted: false,
				isViewOnce: true,
				attachments: [],
			});
			// the peer also pushes a "typing" notification that must be ignored, then a
			// receipt that must not be — it is the only path that puts a tick on screen
			expect(kinds).toEqual([
				"conversation-updated",
				"message",
				"conversation-updated",
				"message",
				"conversation-updated",
				"message",
				"reaction",
				"receipt",
			]);
			expect(receipts).toEqual([{ timestamps: [1_760_000_000_001], state: "read" }]);
			// A reaction names an existing message and carries none of its own: the three
			// messages above are still all that arrived.
			expect(reactions).toEqual([
				{ targetSentAt: 1_760_000_000_000, emoji: "👍", isRemove: false },
			]);
			expect(messages).toHaveLength(3);

			await backend.sendMessage("uuid-alice", "hi back");
			await waitFor(() => existsSync(capture) && readFileSync(capture, "utf8").trim().length > 0);

			const [sent] = readFileSync(capture, "utf8")
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line) as unknown);
			expect(sent).toEqual({ recipient: ["uuid-alice"], message: "hi back" });
			expect(backend.protocolErrors).toEqual([]);
		} finally {
			try {
				await backend.stop();
			} finally {
				rmSync(dir, { recursive: true, force: true });
			}
		}
	}, 15_000);
});
