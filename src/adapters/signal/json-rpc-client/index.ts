/**
 * The JSON-RPC layer, in three pieces: what a call returns or fails with (`errors`), what the
 * wire looks like (`wire`), how a byte stream becomes lines (`framing`), and the client that
 * correlates requests with replies (`client`). Nothing outside imports below this file.
 */
export { JsonRpcClient } from "./client";
export { RpcClosedError, RpcError, RpcTimeoutError } from "./errors";
export { LineFramer } from "./framing";
export {
	DEFAULT_MAX_LINE_BYTES,
	DEFAULT_TIMEOUT_MS,
	type JsonRpcClientOptions,
	type NotificationHandler,
} from "./wire";
