import { describe, expect, test } from "bun:test";
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
		const stream = createProcessStream({ command: [process.execPath, FAKE_PEER] });
		const client = new JsonRpcClient(stream, { defaultTimeoutMs: 5_000 });
		const backend = new SignalCliBackend(client, { account: ACCOUNT });

		const messages: Message[] = [];
		const kinds: BackendEvent["kind"][] = [];
		backend.subscribe((event) => {
			kinds.push(event.kind);
			if (event.kind === "message") {
				messages.push(event.message);
			}
		});

		await backend.start();
		await waitFor(() => messages.length > 0);

		expect(messages[0]).toEqual({
			id: "uuid-alice:1760000000000",
			conversationId: "uuid-alice",
			author: "Alice",
			body: "hello from the fake peer",
			sentAt: 1_760_000_000_000,
			isOutgoing: false,
			isDeleted: false,
		});
		// the peer also pushes a "typing" notification that must be ignored
		expect(kinds).toEqual(["conversation-updated", "message"]);

		await backend.sendMessage("uuid-alice", "hi back");
		await backend.stop();

		expect(backend.protocolErrors).toEqual([]);
	}, 15_000);
});
