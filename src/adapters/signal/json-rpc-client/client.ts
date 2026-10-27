import type { RpcStream } from "../rpc-stream";
import { RpcClosedError, RpcError, RpcTimeoutError } from "./errors";
import { LineFramer } from "./framing";
import {
	DEFAULT_MAX_LINE_BYTES,
	DEFAULT_TIMEOUT_MS,
	type JsonRpcClientOptions,
	type NotificationHandler,
	type PendingRequest,
	type WireMessage,
} from "./wire";

/**
 * Minimal JSON-RPC 2.0 client over a line-delimited stream: request/response correlation by id,
 * per-request timeouts, notification dispatch, and no dependency on a child process.
 *
 * One malformed or hostile line must never stop the read loop, so every inbound line is handled
 * inside a try/catch and reported through `onProtocolError`. The line splitting itself — the
 * buffer and its byte cap — is `LineFramer`'s job, so this class only speaks protocol.
 */
export class JsonRpcClient {
	readonly #stream: RpcStream;
	readonly #defaultTimeoutMs: number;
	readonly #onProtocolError: (error: Error, line: string) => void;
	readonly #framer: LineFramer;

	#pending = new Map<number, PendingRequest>();
	#nextId = 1;
	#closed = false;
	#notificationHandler: NotificationHandler | null = null;

	constructor(stream: RpcStream, options: JsonRpcClientOptions = {}) {
		this.#stream = stream;
		this.#defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
		this.#onProtocolError = options.onProtocolError ?? (() => {});
		this.#framer = new LineFramer({
			maxLineBytes: options.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES,
			onLine: (line) => this.#dispatchLine(line),
			onError: (error, context) => this.#reportProtocolError(error, context),
		});

		stream.onData((chunk) => this.#framer.push(chunk));
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

	/**
	 * A reporting hook is caller-supplied code. If it throws, that must not abort line processing
	 * and strand the remaining lines in the same chunk.
	 */
	#reportProtocolError(error: Error, line: string): void {
		try {
			this.#onProtocolError(error, line);
		} catch {
			// Swallowed on purpose: reporting must never interrupt line processing.
		}
	}

	#dispatchLine(line: string): void {
		// The framer has already enforced the byte cap on this line.
		try {
			this.#handleLine(line);
		} catch (error) {
			// A throwing notification handler must not kill the read loop.
			this.#reportProtocolError(error instanceof Error ? error : new Error(String(error)), line);
		}
	}

	#handleLine(line: string): void {
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch (error) {
			this.#reportProtocolError(error instanceof Error ? error : new Error("invalid JSON"), line);
			return;
		}

		if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
			this.#reportProtocolError(new Error("JSON-RPC message must be an object"), line);
			return;
		}

		const message = parsed as WireMessage;

		if (typeof message.id === "number") {
			this.#settleResponse(message);
			return;
		}

		if (typeof message.method === "string") {
			this.#notificationHandler?.(message.method, message.params ?? null);
			return;
		}

		this.#reportProtocolError(new Error("unrecognised JSON-RPC message shape"), line);
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
