import { JsonRpcClient } from "./json-rpc-client";
import { createProcessStream } from "./process-stream";
import { SignalCliBackend, type SignalCliBackendOptions } from "./signal-cli-backend";

/**
 * Composition for the real engine: spawn `signal-cli` in JSON-RPC manual-receive mode and
 * wrap it. Kept out of the adapter so the adapter itself needs no process and can be tested
 * against a fake caller.
 */

export interface SpawnBackendOptions extends SignalCliBackendOptions {
	/** Defaults to {@link defaultCommand}: manual receive mode, so nothing is
	 * delivered before `start()` installs its handler. */
	readonly command?: readonly string[];
	readonly defaultTimeoutMs?: number;
}

/**
 * `--receive-mode` belongs to the `jsonRpc` subcommand's own parser, not to the
 * global options, so it must come after the command name.
 */
export function defaultCommand(account: string): readonly string[] {
	return ["signal-cli", "-a", account, "jsonRpc", "--receive-mode=manual"];
}

export function spawnSignalCliBackend(options: SpawnBackendOptions): {
	readonly backend: SignalCliBackend;
	readonly client: JsonRpcClient;
} {
	const command = options.command ?? defaultCommand(options.account);
	const stream = createProcessStream({ command });
	const client = new JsonRpcClient(stream, {
		defaultTimeoutMs: options.defaultTimeoutMs ?? 30_000,
	});
	const backendOptions: SignalCliBackendOptions = options.notificationMethod
		? { account: options.account, notificationMethod: options.notificationMethod }
		: { account: options.account };
	return { backend: new SignalCliBackend(client, backendOptions), client };
}
