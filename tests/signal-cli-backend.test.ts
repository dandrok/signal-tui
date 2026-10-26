import { describe, expect, test } from "bun:test";
import { defaultCommand, unwrapNotification } from "../src/adapters/signal/signal-cli-backend";
import { SELF_AUTHOR_ID } from "../src/domain/types";
import { ACCOUNT, directParams, envelope, setup, subscriptionParams } from "./helpers/fake-rpc";

describe("defaultCommand", () => {
	test("puts the subcommand option after the command name", () => {
		// --receive-mode is parsed by the jsonRpc subparser, not the global one.
		expect(defaultCommand("+48123456789")).toEqual([
			"signal-cli",
			"-a",
			"+48123456789",
			"jsonRpc",
			"--receive-mode=manual",
		]);
	});
});

describe("unwrapNotification", () => {
	test("unwraps the subscription response of manual receive mode", () => {
		expect(unwrapNotification(subscriptionParams())).toEqual({
			account: ACCOUNT,
			envelope: envelope({ timestamp: 1_760_000_000_000, message: "hi" }),
		});
	});

	test("passes automatic-mode params through untouched", () => {
		expect(unwrapNotification(directParams())).toEqual(directParams());
	});

	test("survives non-object payloads", () => {
		expect(unwrapNotification(null)).toBeNull();
		expect(unwrapNotification("x")).toBe("x");
	});
});

describe("SignalCliBackend", () => {
	test("subscribes for receives on start", async () => {
		const { rpc, backend } = setup();

		await backend.start();

		expect(rpc.requests).toEqual([{ method: "subscribeReceive" }]);
		expect(rpc.hasListener).toBe(true);
	});

	test("start is idempotent", async () => {
		const { rpc, backend } = setup();

		await backend.start();
		await backend.start();

		expect(rpc.sent("subscribeReceive")).toHaveLength(1);
	});

	test("a failed start leaves no handler behind, so a retry works", async () => {
		const { rpc, backend } = setup();
		rpc.failing.add("subscribeReceive");

		await expect(backend.start()).rejects.toThrow("subscribeReceive failed");
		expect(rpc.hasListener).toBe(false);

		rpc.failing.delete("subscribeReceive");
		await backend.start();

		expect(rpc.sent("subscribeReceive")).toHaveLength(2);
		expect(rpc.hasListener).toBe(true);
	});

	test("rejects a start that returned no subscription id", async () => {
		const { rpc, backend } = setup();
		rpc.results.set("subscribeReceive", "zero");

		await expect(backend.start()).rejects.toThrow("expected a subscription id");
		expect(rpc.hasListener).toBe(false);

		// the cleanup path must leave a usable retry
		rpc.results.set("subscribeReceive", 0);
		await backend.start();
		expect(rpc.hasListener).toBe(true);
	});

	test("reads a subscription-wrapped notification", async () => {
		const { rpc, backend, events } = setup();
		await backend.start();

		rpc.emit("receive", subscriptionParams());

		expect(events.map((event) => event.kind)).toEqual(["conversation-updated", "message"]);
		expect(backend.protocolErrors).toEqual([]);
	});

	test("also reads an unwrapped notification", async () => {
		const { rpc, backend, events } = setup();
		await backend.start();

		rpc.emit("receive", directParams());

		expect(events.map((event) => event.kind)).toEqual(["conversation-updated", "message"]);
	});

	test("ignores notifications of other kinds", async () => {
		const { rpc, backend, events } = setup();
		await backend.start();

		rpc.emit("callEvent", { state: "RINGING" });

		expect(events).toHaveLength(0);
	});

	test("records a protocol error instead of throwing on a bad envelope", async () => {
		const { rpc, backend, events } = setup();
		await backend.start();

		rpc.emit("receive", { subscription: 0, result: { envelope: { nope: true } } });

		expect(events).toHaveLength(0);
		expect(backend.protocolErrors).toHaveLength(1);
		expect(backend.protocolErrors[0]).toContain("invalid envelope");
	});

	test("bounds the protocol error log", async () => {
		const { rpc, backend } = setup();
		await backend.start();

		for (let index = 0; index < 25; index++) {
			rpc.emit("receive", { envelope: { nope: index } });
		}

		expect(backend.protocolErrors).toHaveLength(20);
	});

	test("emits a deletion event naming the deleted message", async () => {
		const { rpc, backend, events } = setup();
		await backend.start();

		rpc.emit("receive", {
			subscription: 0,
			result: {
				account: ACCOUNT,
				envelope: envelope({ timestamp: 9_000, remoteDelete: { timestamp: 1_000 } }),
			},
		});

		expect(events).toEqual([
			{ kind: "message-deleted", conversationId: "uuid-alice", messageId: "uuid-alice:1000" },
		]);
	});

	test("sends a direct message and reports the server timestamp", async () => {
		const { rpc, backend } = setup();
		rpc.results.set("send", { timestamp: 1_760_000_000_500 });

		const result = await backend.sendMessage("uuid-alice", "hello");

		expect(rpc.requests.at(-1)).toEqual({
			method: "send",
			params: { recipient: ["uuid-alice"], message: "hello" },
		});
		expect(result).toEqual({ timestamp: 1_760_000_000_500 });
	});

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

	test("reports no timestamp when the peer omits one", async () => {
		const { backend } = setup();

		expect(await backend.sendMessage("uuid-alice", "hello")).toEqual({ timestamp: undefined });
	});

	test("sends a group message with groupId once the group is known", async () => {
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

		await backend.sendMessage("group-1", "hello group");

		expect(rpc.requests.at(-1)).toEqual({
			method: "send",
			params: { groupId: "group-1", message: "hello group" },
		});
	});

	test("a reaction in a group registers the group, so a later send uses groupId", async () => {
		// A reaction can be the first thing this session sees from a group. If it does not
		// register the id, the next send addresses the group by `recipient`, which the engine
		// cannot resolve — a send that fails with no obvious cause.
		const { rpc, backend } = setup();
		await backend.start();
		rpc.emit("receive", {
			subscription: 0,
			result: {
				account: ACCOUNT,
				envelope: {
					sourceNumber: "+100****0000",
					sourceUuid: "uuid-alice",
					sourceName: "Alice",
					timestamp: 6,
					dataMessage: {
						timestamp: 6,
						groupInfo: { groupId: "group-1", groupName: "Signal devs" },
						reaction: { emoji: "👍", targetSentTimestamp: 5, isRemove: false },
					},
				},
			},
		});

		await backend.sendMessage("group-1", "thanks all");

		expect(rpc.requests.at(-1)).toEqual({
			method: "send",
			params: { groupId: "group-1", message: "thanks all" },
		});
	});

	test("stop unsubscribes, then closes the client", async () => {
		const { rpc, backend } = setup();
		await backend.start();

		await backend.stop();

		expect(rpc.sent("unsubscribeReceive")).toEqual([
			{ method: "unsubscribeReceive", params: { subscription: 0 } },
		]);
		expect(rpc.hasListener).toBe(false);
		expect(rpc.closedWith).toBe("backend stopped");
	});

	test("stop survives a failing unsubscribe", async () => {
		const { rpc, backend } = setup();
		await backend.start();
		rpc.failing.add("unsubscribeReceive");

		await backend.stop();

		expect(rpc.closedWith).toBe("backend stopped");
	});

	test("a listener can unsubscribe itself", async () => {
		const { rpc, backend } = setup();
		let calls = 0;
		const unsubscribe = backend.subscribe(() => {
			calls++;
		});
		await backend.start();

		rpc.emit("receive", directParams());
		unsubscribe();
		rpc.emit("receive", directParams());

		expect(calls).toBe(2);
	});
});
