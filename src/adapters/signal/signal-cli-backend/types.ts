/** The slice of `JsonRpcClient` this adapter needs: narrow on purpose, so a test can fake it. */
export interface RpcCaller {
	request<T = unknown>(method: string, params?: unknown, timeoutMs?: number): Promise<T>;
	onNotification(handler: (method: string, params: unknown) => void): () => void;
	close(reason?: string): void;
}

export interface SignalCliBackendOptions {
	/** Account to act as, e.g. a number in international form. */
	readonly account: string;
	/** JSON-RPC notification method carrying envelopes. signal-cli uses "receive". */
	readonly notificationMethod?: string;
}

export const DEFAULT_NOTIFICATION_METHOD = "receive";
