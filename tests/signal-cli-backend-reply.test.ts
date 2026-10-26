import { describe, expect, test } from "bun:test";
import { SELF_AUTHOR_ID } from "../src/domain/types";
import { ACCOUNT, envelope, setup } from "./helpers/fake-rpc";

/**
 * What a reply puts on the wire. Split from `signal-cli-backend.test.ts` when that file
 * reached the line cap: these three share one subject — the quote parameters `send`
 * takes, and the identifier each kind of target needs.
 */
describe("SignalCliBackend replies", () => {
	test("sends a reply with the timestamp, author and text of the quoted message", async () => {
		// All three are required in practice: the engine rejects a `quoteTimestamp` without a
		// `quoteAuthor`, and a quote with no `quoteMessage` renders as an empty block on the
		// other side — so the text is composed at send time from the cached message rather
		// than kept in the cache twice.
		const { rpc, backend } = setup();

		await backend.sendMessage("uuid-alice", "agreed", {
			sentAt: 1_000,
			authorId: "uuid-marta",
			text: "attachments path also needs the 4 MiB limit",
		});

		expect(rpc.requests.at(-1)).toEqual({
			method: "send",
			params: {
				recipient: ["uuid-alice"],
				message: "agreed",
				quoteTimestamp: 1_000,
				quoteAuthor: "uuid-marta",
				quoteMessage: "attachments path also needs the 4 MiB limit",
			},
		});
	});

	test("quotes our own message by the account number, not the self marker", async () => {
		// `SELF_AUTHOR_ID` is not a number or a uuid, so the engine cannot resolve it; the
		// account number is what it maps back to us.
		const { rpc, backend } = setup();

		await backend.sendMessage("uuid-alice", "adding to that", {
			sentAt: 1_000,
			authorId: SELF_AUTHOR_ID,
			text: "on it, testing now",
		});

		expect(rpc.requests.at(-1)?.params).toMatchObject({ quoteAuthor: ACCOUNT });
	});

	test("sends a group reply with groupId and the quote beside it", async () => {
		const { rpc, backend } = setup();
		await backend.start();
		rpc.emit("receive", {
			subscription: 0,
			result: {
				account: ACCOUNT,
				envelope: envelope({
					timestamp: 5,
					message: "hi all",
					groupInfo: { groupId: "group-1", groupName: "Signal devs" },
				}),
			},
		});

		await backend.sendMessage("group-1", "agreed", {
			sentAt: 5,
			authorId: "uuid-alice",
			text: "hi all",
		});

		expect(rpc.requests.at(-1)).toEqual({
			method: "send",
			params: {
				groupId: "group-1",
				message: "agreed",
				quoteTimestamp: 5,
				quoteAuthor: "uuid-alice",
				quoteMessage: "hi all",
			},
		});
	});
});
