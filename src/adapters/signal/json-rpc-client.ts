import type { RpcStream } from "./rpc-stream";

export class RpcError extends Error {
	readonly code: number;
	readonly data: unknown;

	constructor(code: number, message: string, data: unknown = null) {
		super(message);
		this.name = "RpcError";
		this.code = code;
		this.data = data;
	}
}

export class RpcTimeoutError extends Error {
	constructor(method: string, timeoutMs: number) {
		super(`JSON-RPC request "${method}" timed out after ${timeoutMs}ms`);
		this.name = "RpcTimeoutError";
	}
}

export class RpcClosedError extends Error {
	constructor(reason = "stream closed") {
		super(`JSON-RPC channel closed: ${reason}`);
		this.name = "RpcClosedError";
	}
}

export type NotificationHandler = (method: string, params: unknown) => void;

export interface JsonRpcClientOptions {
	readonly defaultTimeoutMs?: number;
	/** Called for unparseable or unrecognised inbound lines instead of throwing. */
	readonly onProtocolError?: (error: Error, line: string) => void;
}

interface PendingRequest {
	readonly resolve: (value: unknown) => void;
	readonly reject: (error: Error) => void;
	timer: ReturnType<typeof setTimeout> | null;
}

interface WireError {
	readonly code: number;
	readonly message: string;
	readonly data?: unknown;
}

interface WireMessage {
	readonly jsonrpc?: string;
	readonly id?: number | string | null;
	readonly result?: unknown;
	readonly error?: WireError;
	readonly method?: string;
	readonly params?: unknown;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Minimal JSON-RPC 2.0 client over a line-delimited stream: request/response
 * correlation by id, per-request timeouts, notification dispatch, and no
 * dependency on a child process.
 */
export class JsonRpcClient {
	readonly #stream: RpcStream;
	readonly #defaultTimeoutMs: number;
	readonly #onProtocolError: (error: Error, line: string) => void;

	#pending = new Map<number, PendingRequest>();
	#nextId = 1;
	#buffer = "";
	#closed = false;
	#notificationHandler: NotificationHandler | null = null;

	constructor(stream: RpcStream, options: JsonRpcClientOptions = {}) {
		this.#stream = stream;
		this.#defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
		this.#onProtocolError = options.onProtocolError ?? (() => {});

		stream.onData((chunk) => this.#ingest(chunk));
		stream.onClose((reason) => this.#failAll(new RpcClosedError(reason)));
	}

	get pendingCount(): number {
		return this.#pending.size;
	}

	request<T = unknown>(method: string, params?: unknown, timeoutMs?: number): Promise<T> {
		if (this.#closed) {
			return Promise.reject(new RpcClosedError("client is closed"));
		}

		const id = this.#nextId++;
		const payload: Record<string, unknown> = { jsonrpc: "2.0", id, method };
		if (params !== undefined) {
			payload.params = params;
		}

		return new Promise<T>((resolve, reject) => {
			const timeout = timeoutMs ?? this.#defaultTimeoutMs;
			const timer =
				timeout > 0
					? setTimeout(() => {
							this.#pending.delete(id);
							reject(new RpcTimeoutError(method, timeout));
						}, timeout)
					: null;

			this.#pending.set(id, { resolve: (value) => resolve(value as T), reject, timer });

			try {
				this.#stream.write(JSON.stringify(payload));
			} catch (error) {
				this.#settle(id);
				reject(error instanceof Error ? error : new Error(String(error)));
			}
		});
	}

	/** Only one notification handler is kept; returns an unsubscribe function. */
	onNotification(handler: NotificationHandler): () => void {
		this.#notificationHandler = handler;
		return () => {
			if (this.#notificationHandler === handler) {
				this.#notificationHandler = null;
			}
		};
	}

	close(reason = "client closed"): void {
		if (this.#closed) {
			return;
		}
		this.#closed = true;
		this.#failAll(new RpcClosedError(reason));
		this.#stream.close(reason);
	}

	#ingest(chunk: string): void {
		this.#buffer += chunk;
		let newlineIndex = this.#buffer.indexOf("\n");
		while (newlineIndex >= 0) {
			const line = this.#buffer.slice(0, newlineIndex).trim();
			this.#buffer = this.#buffer.slice(newlineIndex + 1);
			if (line.length > 0) {
				this.#handleLine(line);
			}
			newlineIndex = this.#buffer.indexOf("\n");
		}
	}

	#handleLine(line: string): void {
		let message: WireMessage;
		try {
			message = JSON.parse(line) as WireMessage;
		} catch (error) {
			this.#onProtocolError(error instanceof Error ? error : new Error("invalid JSON"), line);
			return;
		}

		if (typeof message.id === "number") {
			this.#settleResponse(message);
			return;
		}

		if (typeof message.method === "string") {
			this.#notificationHandler?.(message.method, message.params ?? null);
			return;
		}

		this.#onProtocolError(new Error("unrecognised JSON-RPC message shape"), line);
	}

	#settleResponse(message: WireMessage): void {
		const id = message.id as number;
		const pending = this.#pending.get(id);
		if (!pending) {
			// Late or duplicate response (e.g. after a timeout): ignore, never crash.
			return;
		}
		this.#settle(id);

		if (message.error) {
			pending.reject(
				new RpcError(message.error.code, message.error.message, message.error.data ?? null),
			);
			return;
		}
		pending.resolve(message.result ?? null);
	}

	#settle(id: number): void {
		const pending = this.#pending.get(id);
		if (!pending) {
			return;
		}
		if (pending.timer !== null) {
			clearTimeout(pending.timer);
		}
		this.#pending.delete(id);
	}

	#failAll(error: Error): void {
		this.#closed = true;
		for (const [id, pending] of this.#pending) {
			if (pending.timer !== null) {
				clearTimeout(pending.timer);
			}
			this.#pending.delete(id);
			pending.reject(error);
		}
	}
}
