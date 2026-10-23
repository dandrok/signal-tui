import { describe, expect, test } from "bun:test";
import type { RpcCaller } from "../src/adapters/signal/signal-cli-backend";
import {
	defaultCommand,
	SignalCliBackend,
	unwrapNotification,
} from "../src/adapters/signal/signal-cli-backend";
import type { BackendEvent } from "../src/ports/backend";

class FakeRpc implements RpcCaller {
	readonly requests: Array<{ method: string; params?: unknown }> = [];
	readonly results = new Map<string, unknown>();
	readonly failing = new Set<string>();
	closedWith: string | null = null;

	#handler: ((method: string, params: unknown) => void) | null = null;

	async request<T = unknown>(method: string, params?: unknown): Promise<T> {
		this.requests.push(params === undefined ? { method } : { method, params });
		if (this.failing.has(method)) {
			throw new Error(`${method} failed`);
		}
		return this.results.get(method) as T;
	}

	onNotification(handler: (method: string, params: unknown) => void): () => void {
		this.#handler = handler;
		return () => {
			this.#handler = null;
		};
	}

	close(reason?: string): void {
		this.closedWith = reason ?? "closed";
		this.#handler = null;
	}

	emit(method: string, params: unknown): void {
		this.#handler?.(method, params);
	}

	get hasListener(): boolean {
		return this.#handler !== null;
	}

	sent(method: string): Array<{ method: string; params?: unknown }> {
		return this.requests.filter((request) => request.method === method);
	}
}

const ACCOUNT = "+10000000000";

const envelope = (dataMessage: Record<string, unknown>) => ({
	sourceNumber: ACCOUNT,
	sourceUuid: "uuid-alice",
	sourceName: "Alice",
	sourceDevice: 1,
	timestamp: 1,
	dataMessage,
});

/** Auto mode: the envelope sits directly in params. */
const directParams = () => ({
	envelope: envelope({ timestamp: 1_760_000_000_000, message: "hi" }),
});

/** Manual mode: the envelope is wrapped in a subscription response. */
const subscriptionParams = () => ({
	subscription: 0,
	result: { account: ACCOUNT, envelope: envelope({ timestamp: 1_760_000_000_000, message: "hi" }) },
});

const setup = () => {
	const rpc = new FakeRpc();
	rpc.results.set("subscribeReceive", 0);
	const backend = new SignalCliBackend(rpc, { account: ACCOUNT });
	const events: BackendEvent[] = [];
	backend.subscribe((event) => events.push(event));
	return { rpc, backend, events };
};

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

	test("sends a direct message with the account and recipient", async () => {
		const { rpc, backend } = setup();

		await backend.sendMessage("uuid-alice", "hello");

		expect(rpc.requests.at(-1)).toEqual({
			method: "send",
			params: { recipient: ["uuid-alice"], message: "hello" },
		});
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
