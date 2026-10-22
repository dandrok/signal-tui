import type { RpcStream } from "../../src/adapters/signal/rpc-stream";

/**
 * In-memory {@link RpcStream} for tests: records what the client writes and lets
 * a test inject inbound text, including partial lines and abrupt closes.
 */
export class FakeStream implements RpcStream {
	readonly written: string[] = [];
	closed = false;

	#dataHandlers = new Set<(chunk: string) => void>();
	#closeHandlers = new Set<(reason?: string) => void>();

	write(line: string): void {
		if (this.closed) {
			throw new Error("write after close");
		}
		this.written.push(line);
	}

	onData(handler: (chunk: string) => void): () => void {
		this.#dataHandlers.add(handler);
		return () => {
			this.#dataHandlers.delete(handler);
		};
	}

	onClose(handler: (reason?: string) => void): () => void {
		this.#closeHandlers.add(handler);
		return () => {
			this.#closeHandlers.delete(handler);
		};
	}

	close(reason?: string): void {
		if (this.closed) {
			return;
		}
		this.closed = true;
		for (const handler of this.#closeHandlers) {
			handler(reason);
		}
	}

	/** Simulate the peer sending raw text (may be a partial line). */
	push(chunk: string): void {
		for (const handler of this.#dataHandlers) {
			handler(chunk);
		}
	}

	sent(): Array<Record<string, unknown>> {
		return this.written.map((line) => JSON.parse(line) as Record<string, unknown>);
	}
}
