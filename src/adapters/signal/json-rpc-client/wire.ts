/** The JSON-RPC wire shapes, as this client reads them: shape, not schema. */
export type NotificationHandler = (method: string, params: unknown) => void;

export interface JsonRpcClientOptions {
	readonly defaultTimeoutMs?: number;
	/** Called for unparseable, oversized or unrecognised inbound lines instead of throwing. */
	readonly onProtocolError?: (error: Error, line: string) => void;
	/** Inbound line limit; a peer that never sends a newline cannot grow the buffer forever. */
	readonly maxLineBytes?: number;
}

export interface PendingRequest {
	readonly resolve: (value: unknown) => void;
	readonly reject: (error: Error) => void;
	timer: ReturnType<typeof setTimeout> | null;
}

export interface WireError {
	readonly code: number;
	readonly message: string;
	readonly data?: unknown;
}

export interface WireMessage {
	readonly jsonrpc?: string;
	readonly id?: number | string | null;
	readonly result?: unknown;
	readonly error?: WireError;
	readonly method?: string;
	readonly params?: unknown;
}

export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_LINE_BYTES = 8 * 1024 * 1024;
