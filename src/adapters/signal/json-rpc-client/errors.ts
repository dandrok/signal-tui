/** The three ways a call can fail, each distinguishable by the caller. */

/** The peer answered with a JSON-RPC error object. */
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

/** No answer arrived in time. The request is forgotten, and a late reply is ignored. */
export class RpcTimeoutError extends Error {
	constructor(method: string, timeoutMs: number) {
		super(`JSON-RPC request "${method}" timed out after ${timeoutMs}ms`);
		this.name = "RpcTimeoutError";
	}
}

/** The channel is gone: every pending call is rejected with this, not left hanging. */
export class RpcClosedError extends Error {
	constructor(reason = "stream closed") {
		super(`JSON-RPC channel closed: ${reason}`);
		this.name = "RpcClosedError";
	}
}
