import type { ConversationId } from "../../domain/types";
import type { BackendEvent, SignalBackend } from "../../ports/backend";
import { JsonRpcClient } from "./json-rpc-client";
import { mapEnvelope } from "./map-envelope";
import { createProcessStream } from "./process-stream";
import { receiveEnvelopeSchema } from "./schemas";

/**
 * The slice of {@link JsonRpcClient} this adapter needs. Narrow on purpose: tests
 * pass a fake, and the real client satisfies it structurally.
 */
export interface RpcCaller {
	request<T = unknown>(method: string, params?: unknown, timeoutMs?: number): Promise<T>;
	onNotification(handler: (method: string, params: unknown) => void): () => void;
	close(reason?: string): void;
}

export interface SignalCliBackendOptions {
	/** Account to act as, e.g. "+48123456789". */
	readonly account: string;
	/** JSON-RPC notification method carrying envelopes. signal-cli uses "receive". */
	readonly notificationMethod?: string;
}

const DEFAULT_NOTIFICATION_METHOD = "receive";

export class SignalCliBackend implements SignalBackend {
	readonly #client: RpcCaller;
	readonly #account: string;
	readonly #notificationMethod: string;

	#listeners = new Set<(event: BackendEvent) => void>();
	#unsubscribe: (() => void) | null = null;
	#protocolErrors: string[] = [];

	constructor(client: RpcCaller, options: SignalCliBackendOptions) {
		this.#client = client;
		this.#account = options.account;
		this.#notificationMethod = options.notificationMethod ?? DEFAULT_NOTIFICATION_METHOD;
	}

	/** Messages that failed validation or could not be mapped. Bounded to the last 20. */
	get protocolErrors(): readonly string[] {
		return this.#protocolErrors;
	}

	async start(): Promise<void> {
		if (this.#unsubscribe !== null) {
			return;
		}
		this.#unsubscribe = this.#client.onNotification((method, params) => {
			this.#handleNotification(method, params);
		});
		await this.#client.request("subscribeReceive", { account: this.#account });
	}

	async stop(): Promise<void> {
		this.#unsubscribe?.();
		this.#unsubscribe = null;
		this.#client.close("backend stopped");
	}

	async sendMessage(conversationId: ConversationId, body: string): Promise<void> {
		await this.#client.request("send", {
			account: this.#account,
			recipient: [conversationId],
			message: body,
		});
	}

	subscribe(listener: (event: BackendEvent) => void): () => void {
		this.#listeners.add(listener);
		return () => {
			this.#listeners.delete(listener);
		};
	}

	#handleNotification(method: string, params: unknown): void {
		if (method !== this.#notificationMethod) {
			return;
		}

		const parsed = receiveEnvelopeSchema.safeParse(params);
		if (!parsed.success) {
			this.#recordProtocolError(
				`invalid envelope: ${parsed.error.issues[0]?.message ?? "unknown"}`,
			);
			return;
		}

		const mapped = mapEnvelope(parsed.data.envelope);
		if (mapped.conversation !== null) {
			this.#emit({ kind: "conversation-updated", conversation: mapped.conversation });
		}
		if (mapped.message !== null) {
			this.#emit({ kind: "message", message: mapped.message });
		}
	}

	#recordProtocolError(message: string): void {
		this.#protocolErrors.push(message);
		if (this.#protocolErrors.length > 20) {
			this.#protocolErrors.shift();
		}
	}

	#emit(event: BackendEvent): void {
		for (const listener of this.#listeners) {
			listener(event);
		}
	}
}

export interface SpawnBackendOptions extends SignalCliBackendOptions {
	/** Defaults to `signal-cli -a <account> jsonRpc`. */
	readonly command?: readonly string[];
	readonly defaultTimeoutMs?: number;
}

/**
 * Composition helper: spawns `signal-cli` in JSON-RPC mode and wraps it.
 * Kept separate from the adapter so the adapter itself needs no process at all.
 */
export function spawnSignalCliBackend(options: SpawnBackendOptions): {
	readonly backend: SignalCliBackend;
	readonly client: JsonRpcClient;
} {
	const command = options.command ?? ["signal-cli", "-a", options.account, "jsonRpc"];
	const stream = createProcessStream({ command });
	const client = new JsonRpcClient(stream, {
		defaultTimeoutMs: options.defaultTimeoutMs ?? 30_000,
	});
	const backendOptions: SignalCliBackendOptions = options.notificationMethod
		? { account: options.account, notificationMethod: options.notificationMethod }
		: { account: options.account };
	return { backend: new SignalCliBackend(client, backendOptions), client };
}
