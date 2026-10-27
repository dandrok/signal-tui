import { describe, expect, test } from "bun:test";
import { SELF_AUTHOR_ID } from "../src/domain/types";
import { ACCOUNT, setup } from "./helpers/fake-rpc";

/**
 * What a reaction puts on the wire.
 *
 * The params come from `SendReactionCommand`: the emoji, the message named by timestamp and
 * author, and the same recipient options `send` takes. `remove` is a `storeTrue` flag
 * upstream, so it is absent rather than false.
 */
describe("SignalCliBackend reactions", () => {
	test("reacts to a message in a direct chat", async () => {
		const { rpc, backend } = setup();

		await backend.sendReaction("uuid-alice", { sentAt: 1_000, authorId: "uuid-marta" }, "👍");

		expect(rpc.requests.at(-1)).toEqual({
			method: "sendReaction",
			params: {
				recipient: ["uuid-alice"],
				emoji: "👍",
				targetAuthor: "uuid-marta",
				targetTimestamp: 1_000,
			},
		});
	});

	test("addresses a group by id once the session has seen it", async () => {
		const { rpc, backend } = setup();
		// A reaction on a group message is also the first thing a session may see from that
		// group, so the group has to be known before the send — the same rule as a reply.
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

		await backend.sendReaction("group-1", { sentAt: 1, authorId: "uuid-alice" }, "❤️");

		expect(rpc.requests.at(-1)).toEqual({
			method: "sendReaction",
			params: {
				groupId: "group-1",
				emoji: "❤️",
				targetAuthor: "uuid-alice",
				targetTimestamp: 1,
			},
		});
	});

	test("names our own message by the account number, not the self marker", async () => {
		// `SELF_AUTHOR_ID` is neither a number nor a uuid, so the engine cannot resolve it.
		const { rpc, backend } = setup();

		await backend.sendReaction("uuid-alice", { sentAt: 1_000, authorId: SELF_AUTHOR_ID }, "👍");

		expect(rpc.requests.at(-1)?.params).toMatchObject({ targetAuthor: ACCOUNT });
	});

	test("sends the remove flag only when removing", async () => {
		const { rpc, backend } = setup();

		await backend.sendReaction("uuid-alice", { sentAt: 1_000, authorId: "uuid-alice" }, "👍", true);

		expect(rpc.requests.at(-1)?.params).toMatchObject({ remove: true });
		expect(rpc.requests.at(-1)?.params).not.toHaveProperty("remove", false);
	});
});
