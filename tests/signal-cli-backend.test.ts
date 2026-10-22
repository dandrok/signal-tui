import { describe, expect, test } from "bun:test";
import type { RpcCaller } from "../src/adapters/signal/signal-cli-backend";
import { SignalCliBackend } from "../src/adapters/signal/signal-cli-backend";
import type { BackendEvent } from "../src/ports/backend";

class FakeRpc implements RpcCaller {
	readonly requests: Array<{ method: string; params?: unknown }> = [];
	closedWith: string | null = null;

	#handler: ((method: string, params: unknown) => void) | null = null;

	async request<T = unknown>(method: string, params?: unknown): Promise<T> {
		this.requests.push(params === undefined ? { method } : { method, params });
		return undefined as T;
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
}

const envelope = {
	account: "+10000000000",
	envelope: {
		source: "+10000000000",
		sourceNumber: "+10000000000",
		sourceUuid: "uuid-alice",
		sourceName: "Alice",
		sourceDevice: 1,
		timestamp: 1,
		dataMessage: { timestamp: 1_760_000_000_000, message: "hi" },
	},
};

describe("SignalCliBackend", () => {
	test("subscribes for receives on start", async () => {
		const rpc = new FakeRpc();
		const backend = new SignalCliBackend(rpc, { account: "+10000000000" });

		await backend.start();

		expect(rpc.requests).toEqual([
			{ method: "subscribeReceive", params: { account: "+10000000000" } },
		]);
		expect(rpc.hasListener).toBe(true);
	});

	test("start is idempotent", async () => {
		const rpc = new FakeRpc();
		const backend = new SignalCliBackend(rpc, { account: "+1" });

		await backend.start();
		await backend.start();

		expect(rpc.requests).toHaveLength(1);
	});

	test("emits conversation and message events for a received envelope", async () => {
		const rpc = new FakeRpc();
		const backend = new SignalCliBackend(rpc, { account: "+1" });
		const events: BackendEvent[] = [];
		backend.subscribe((event) => events.push(event));
		await backend.start();

		rpc.emit("receive", envelope);

		expect(events.map((event) => event.kind)).toEqual(["conversation-updated", "message"]);
		const message = events[1];
		expect(message?.kind === "message" && message.message.body).toBe("hi");
	});

	test("ignores notifications of other kinds", async () => {
		const rpc = new FakeRpc();
		const backend = new SignalCliBackend(rpc, { account: "+1" });
		const events: BackendEvent[] = [];
		backend.subscribe((event) => events.push(event));
		await backend.start();

		rpc.emit("callEvent", { state: "RINGING" });

		expect(events).toHaveLength(0);
	});

	test("records a protocol error instead of throwing on a bad envelope", async () => {
		const rpc = new FakeRpc();
		const backend = new SignalCliBackend(rpc, { account: "+1" });
		const events: BackendEvent[] = [];
		backend.subscribe((event) => events.push(event));
		await backend.start();

		rpc.emit("receive", { envelope: { nope: true } });

		expect(events).toHaveLength(0);
		expect(backend.protocolErrors).toHaveLength(1);
		expect(backend.protocolErrors[0]).toContain("invalid envelope");
	});

	test("bounds the protocol error log", async () => {
		const rpc = new FakeRpc();
		const backend = new SignalCliBackend(rpc, { account: "+1" });
		await backend.start();

		for (let index = 0; index < 25; index++) {
			rpc.emit("receive", { envelope: { nope: index } });
		}

		expect(backend.protocolErrors).toHaveLength(20);
	});

	test("sends a message with the account and recipient", async () => {
		const rpc = new FakeRpc();
		const backend = new SignalCliBackend(rpc, { account: "+1" });

		await backend.sendMessage("uuid-alice", "hello");

		expect(rpc.requests.at(-1)).toEqual({
			method: "send",
			params: { account: "+1", recipient: ["uuid-alice"], message: "hello" },
		});
	});

	test("stop unsubscribes and closes the client", async () => {
		const rpc = new FakeRpc();
		const backend = new SignalCliBackend(rpc, { account: "+1" });
		await backend.start();

		await backend.stop();

		expect(rpc.hasListener).toBe(false);
		expect(rpc.closedWith).toBe("backend stopped");
	});

	test("a listener can unsubscribe itself", async () => {
		const rpc = new FakeRpc();
		const backend = new SignalCliBackend(rpc, { account: "+1" });
		let calls = 0;
		const unsubscribe = backend.subscribe(() => {
			calls++;
		});
		await backend.start();

		rpc.emit("receive", envelope);
		unsubscribe();
		rpc.emit("receive", envelope);

		expect(calls).toBe(2);
	});
});
