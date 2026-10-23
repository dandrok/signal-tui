/**
 * Minimal stand-in for `signal-cli -a <account> jsonRpc`, spawned by
 * `tests/integration.test.ts`. Answers `subscribeReceive` (then pushes one
 * `receive` notification and one ignorable `typing` notification), answers
 * `send`, and rejects everything else with a JSON-RPC error.
 */
export {};

const ACCOUNT = "+10000000000";

const write = (value: unknown): void => {
	process.stdout.write(`${JSON.stringify(value)}\n`);
};

for await (const line of console) {
	if (line.trim().length === 0) {
		continue;
	}

	const request = JSON.parse(line) as { id?: number; method?: string };

	if (request.method === "subscribeReceive") {
		write({ jsonrpc: "2.0", id: request.id, result: {} });
		write({
			jsonrpc: "2.0",
			method: "receive",
			params: {
				account: ACCOUNT,
				envelope: {
					sourceNumber: ACCOUNT,
					sourceUuid: "uuid-alice",
					sourceName: "Alice",
					sourceDevice: 1,
					timestamp: 1_760_000_000_000,
					dataMessage: { timestamp: 1_760_000_000_000, message: "hello from the fake peer" },
				},
			},
		});
		write({
			jsonrpc: "2.0",
			method: "typing",
			params: { envelope: { timestamp: 1, typingMessage: { action: "STARTED", timestamp: 1 } } },
		});
		continue;
	}

	if (request.method === "send") {
		write({ jsonrpc: "2.0", id: request.id, result: { timestamp: 1_760_000_000_001 } });
		continue;
	}

	write({
		jsonrpc: "2.0",
		id: request.id ?? null,
		error: { code: -32601, message: `unknown method ${request.method}` },
	});
}
