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
		// A view-once photo: the sender asked for it not to be kept, so the adapter must
		// hand over a row with no text and no file references.
		notify({
			sourceNumber: "+100****0000",
			sourceUuid: "uuid-alice",
			sourceName: "Alice",
			sourceDevice: 1,
			timestamp: 1_760_000_000_003,
			dataMessage: {
				timestamp: 1_760_000_000_003,
				viewOnce: true,
				attachments: [
					{
						id: "att-1",
						contentType: "image/jpeg",
						isVoiceNote: false,
						filename: "/home/you/.local/share/signal-cli/attachments/secret.jpg",
						size: 41_000,
						caption: "burn after reading",
					},
				],
			},
		});
		// A reaction on the first message: an event about a message that already exists,
		// which must not be stored as a message of its own.
		notify({
			sourceNumber: "+100****0000",
			sourceUuid: "uuid-alice",
			sourceName: "Alice",
			sourceDevice: 1,
			timestamp: 1_760_000_000_004,
			dataMessage: {
				timestamp: 1_760_000_000_004,
				reaction: {
					emoji: "👍",
					targetSentTimestamp: 1_760_000_000_000,
					targetAuthorUuid: "self",
					isRemove: false,
				},
			},
		});
		// A sticker: a data message with no text and no file. It is an event about the
		// conversation, not a message, so it must not become a blank row.
		notify({
			sourceNumber: ACCOUNT,
			sourceUuid: "uuid-alice",
			sourceName: "Alice",
			sourceDevice: 1,
			timestamp: 1_760_000_000_005,
			dataMessage: { timestamp: 1_760_000_000_005, sticker: { packId: "pack", stickerId: 3 } },
		});
		// The peer switched the disappearing-messages timer on: a data message with no
		// content, which must move the conversation's timer and never become a row.
		notify({
			sourceNumber: ACCOUNT,
			sourceUuid: "uuid-alice",
			sourceName: "Alice",
			sourceDevice: 1,
			timestamp: 1_760_000_000_007,
			dataMessage: {
				timestamp: 1_760_000_000_007,
				isExpirationUpdate: true,
				expiresInSeconds: 86_400,
			},
		});
		// A correction made on another device: the transcript carries `editMessage` and no
		// flattened data message, and it must reach the store as an edit, never as a row.
		notify({
			timestamp: 1_760_000_000_006,
			syncMessage: {
				sentMessage: {
					destinationUuid: "uuid-bob",
					destinationNumber: "+100****0009",
					editMessage: {
						targetSentTimestamp: 1_760_000_000_001,
						dataMessage: { timestamp: 1_760_000_000_001, message: "sent from my phone, fixed" },
					},
				},
			},
		});
		// A notification kind the adapter must ignore.
		write({
			jsonrpc: "2.0",
			method: "typing",
			params: { envelope: { timestamp: 1, typingMessage: { action: "STARTED", timestamp: 1 } } },
		});
		// The other side acknowledging the message in the sync transcript above. A
		// receipt names messages by timestamp and carries no conversation of its own.
		notify({
			sourceNumber: "+100****0009",
			sourceUuid: "uuid-bob",
			sourceName: "Bob",
			sourceDevice: 1,
			timestamp: 1_760_000_000_002,
			receiptMessage: {
				when: 1_760_000_000_002,
				isDelivery: false,
				isRead: true,
				isViewed: false,
				timestamps: [1_760_000_000_001],
			},
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
