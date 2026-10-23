import type { RpcCaller } from "../../src/adapters/signal/signal-cli-backend";
import { SignalCliBackend } from "../../src/adapters/signal/signal-cli-backend";
import type { BackendEvent } from "../../src/ports/backend";

/** In-memory stand-in for JsonRpcClient: records calls, replays canned results. */
export class FakeRpc implements RpcCaller {
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

export const ACCOUNT = "+10000000000";

export const envelope = (dataMessage: Record<string, unknown>) => ({
	sourceNumber: ACCOUNT,
	sourceUuid: "uuid-alice",
	sourceName: "Alice",
	sourceDevice: 1,
	timestamp: 1,
	dataMessage,
});

/** Automatic receive mode: the envelope sits directly in params. */
export const directParams = () => ({
	envelope: envelope({ timestamp: 1_760_000_000_000, message: "hi" }),
});

/** Manual receive mode: the envelope is wrapped in a subscription response. */
export const subscriptionParams = () => ({
	subscription: 0,
	result: { account: ACCOUNT, envelope: envelope({ timestamp: 1_760_000_000_000, message: "hi" }) },
});

export const setup = () => {
	const rpc = new FakeRpc();
	rpc.results.set("subscribeReceive", 0);
	const backend = new SignalCliBackend(rpc, { account: ACCOUNT });
	const events: BackendEvent[] = [];
	backend.subscribe((event) => events.push(event));
	return { rpc, backend, events };
};
