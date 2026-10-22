/**
 * A line-oriented, bidirectional channel to a JSON-RPC peer.
 *
 * Kept deliberately small so the protocol layer can be unit-tested with an
 * in-memory implementation, while the real one wraps a child process.
 */
export interface RpcStream {
	/** Write one complete line. Implementations append the newline. */
	write(line: string): void;
	/** Subscribe to raw incoming text. Returns an unsubscribe function. */
	onData(handler: (chunk: string) => void): () => void;
	/** Subscribe to termination. Returns an unsubscribe function. */
	onClose(handler: (reason?: string) => void): () => void;
	/** Terminate the underlying channel. */
	close(reason?: string): void;
}
