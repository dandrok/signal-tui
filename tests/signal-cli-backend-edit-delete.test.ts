import { describe, expect, test } from "bun:test";
import { SELF_AUTHOR_ID } from "../src/domain/types";
import { ACCOUNT, setup } from "./helpers/fake-rpc";

/**
 * What an edit and a delete-for-everyone put on the wire.
 *
 * Checked against signal-cli v0.14.9 rather than assumed, because the two commands differ in
 * a way that is easy to get wrong: an **edit is a `send`** carrying `editTimestamp`
 * (`SendCommand` → `sendEditMessage`), while a delete is **its own method**, `remoteDelete`,
 * whose only required argument is the target timestamp (`RemoteDeleteCommand` →
 * `sendRemoteDeleteMessage`). Passing one for the other produces an envelope nobody reads.
 */

describe("SignalCliBackend edits", () => {
	test("an edit is a send carrying the target's timestamp", async () => {
		const { rpc, backend } = setup();

		await backend.sendEdit(
			"uuid-alice",
			{ sentAt: 1_000, authorId: SELF_AUTHOR_ID },
			"hello, fixed",
		);

		expect(rpc.requests.at(-1)).toEqual({
			method: "send",
			params: {
				recipient: ["uuid-alice"],
				message: "hello, fixed",
				editTimestamp: 1_000,
			},
		});
	});

	test("an edit to our own message is addressed by the account, not the self marker", async () => {
		const { rpc, backend } = setup();

		await backend.sendEdit("uuid-alice", { sentAt: 7, authorId: SELF_AUTHOR_ID }, "x");

		// The engine resolves `quoteAuthor`/`targetAuthor` to a number or uuid; `SELF_AUTHOR_ID`
		// is neither. An edit carries no author at all, so the check is that we did not smuggle
		// one in: the params are exactly three fields.
		expect(Object.keys((rpc.requests.at(-1)?.params ?? {}) as object).sort()).toEqual([
			"editTimestamp",
			"message",
			"recipient",
		]);
	});

	test("an edit in a group is addressed by group id", async () => {
		const { rpc, backend } = setup();
		await backend.start();
		rpc.emit("receive", {
			envelope: {
				sourceNumber: "+100****0000",
				sourceUuid: "uuid-alice",
				sourceName: "Alice",
				timestamp: 1,
				dataMessage: {
					timestamp: 1,
					message: "hello group",
					groupInfo: { groupId: "group-1", groupName: "Signal devs" },
				},
			},
		});

		await backend.sendEdit("group-1", { sentAt: 2_000, authorId: SELF_AUTHOR_ID }, "fixed");

		expect(rpc.requests.at(-1)).toEqual({
			method: "send",
			params: { groupId: "group-1", message: "fixed", editTimestamp: 2_000 },
		});
	});
});

describe("SignalCliBackend deletes", () => {
	test("a delete is the remoteDelete method, without a body", async () => {
		const { rpc, backend } = setup();

		await backend.deleteForEveryone("uuid-alice", { sentAt: 1_000, authorId: SELF_AUTHOR_ID });

		expect(rpc.requests.at(-1)).toEqual({
			method: "remoteDelete",
			params: { recipient: ["uuid-alice"], targetTimestamp: 1_000 },
		});
	});

	test("a delete in a group is addressed by group id", async () => {
		const { rpc, backend } = setup();
		await backend.start();
		rpc.emit("receive", {
			envelope: {
				sourceNumber: "+100****0000",
				sourceUuid: "uuid-alice",
				sourceName: "Alice",
				timestamp: 1,
				dataMessage: {
					timestamp: 1,
					message: "hello group",
					groupInfo: { groupId: "group-1", groupName: "Signal devs" },
				},
			},
		});

		await backend.deleteForEveryone("group-1", { sentAt: 3_000, authorId: ACCOUNT });

		expect(rpc.requests.at(-1)).toEqual({
			method: "remoteDelete",
			params: { groupId: "group-1", targetTimestamp: 3_000 },
		});
	});
});
