/**
 * Minimal stand-in for `signal-cli -a <account> --receive-mode=manual jsonRpc`,
 * spawned by `tests/integration.test.ts`.
 *
 * Manual receive mode wraps every notification in a subscription response, so
 * this peer does too — that shape is what the adapter must parse.
 *
 * The first argument is an optional capture file: every `send` request params
 * object is appended there as one JSON line, so the test can assert what the
 * adapter actually put on the wire instead of trusting a successful response.
 */
import { appendFileSync } from "node:fs";

const ACCOUNT = "+10000000000";
const capturePath = process.argv[2];

const write = (value: unknown): void => {
	process.stdout.write(`${JSON.stringify(value)}\n`);
};

const notify = (envelope: unknown): void => {
	write({
		jsonrpc: "2.0",
		method: "receive",
		params: { subscription: 0, result: { account: ACCOUNT, envelope } },
	});
};

for await (const line of console) {
	if (line.trim().length === 0) {
		continue;
	}

	const request = JSON.parse(line) as { id?: number; method?: string; params?: unknown };

	if (request.method === "subscribeReceive") {
		write({ jsonrpc: "2.0", id: request.id, result: 0 });
		notify({
			sourceNumber: ACCOUNT,
			sourceUuid: "uuid-alice",
			sourceName: "Alice",
			sourceDevice: 1,
			timestamp: 1_760_000_000_000,
			dataMessage: { timestamp: 1_760_000_000_000, message: "hello from the fake peer" },
		});
		// Your own message, echoed to this device as a sync transcript.
		notify({
			timestamp: 1_760_000_000_002,
			syncMessage: {
				sentMessage: {
					timestamp: 1_760_000_000_001,
					message: "sent from my phone",
					destinationUuid: "uuid-bob",
					destinationNumber: "+10000000009",
				},
			},
		});
		// A notification kind the adapter must ignore.
		write({
			jsonrpc: "2.0",
			method: "typing",
			params: { envelope: { timestamp: 1, typingMessage: { action: "STARTED", timestamp: 1 } } },
		});
		continue;
	}

	if (request.method === "send") {
		if (capturePath !== undefined) {
			appendFileSync(capturePath, `${JSON.stringify(request.params)}\n`);
		}
		write({ jsonrpc: "2.0", id: request.id, result: { timestamp: 1_760_000_000_001 } });
		continue;
	}

	if (request.method === "unsubscribeReceive") {
		write({ jsonrpc: "2.0", id: request.id, result: {} });
		continue;
	}

	write({
		jsonrpc: "2.0",
		id: request.id ?? null,
		error: { code: -32601, message: `unknown method ${request.method}` },
	});
}
