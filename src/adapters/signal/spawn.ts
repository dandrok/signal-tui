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
	/** The user's standing engine arguments, placed before the subcommand. */
	readonly engineArgs?: readonly string[];
	/** Ask the engine not to download the files that arrive with messages. */
	readonly ignoreAttachments?: boolean;
	readonly defaultTimeoutMs?: number;
}

/** What the command line is built from, beyond the account. */
export interface CommandOptions {
	/** Global `signal-cli` options: they must come before the subcommand's own parser. */
	readonly engineArgs?: readonly string[];
	/** Belongs to the `jsonRpc` subparser, so it goes after the subcommand name. */
	readonly ignoreAttachments?: boolean;
}

/**
 * The command line, and the two halves of it.
 *
 * `--receive-mode` belongs to the `jsonRpc` subcommand's own parser, not to the global
 * options, so it must come after the command name — and so must `--ignore-attachments`,
 * which `JsonRpcDispatcherCommand` registers on the same subparser (v0.14.9: it is listed
 * under `jsonRpc` in the man page and declared in `JsonRpcDispatcherCommand`). A user's
 * `engineArgs`, by contrast, are global options (`--config`, a proxy, a log level): they
 * belong *before* `jsonRpc`, and one of them after it is rejected by that parser.
 */
export function defaultCommand(account: string, options: CommandOptions = {}): readonly string[] {
	return [
		"signal-cli",
		"-a",
		account,
		...(options.engineArgs ?? []),
		"jsonRpc",
		"--receive-mode=manual",
		...(options.ignoreAttachments === true ? ["--ignore-attachments"] : []),
	];
}

export function spawnSignalCliBackend(options: SpawnBackendOptions): {
	readonly backend: SignalCliBackend;
	readonly client: JsonRpcClient;
} {
	const command =
		options.command ??
		defaultCommand(options.account, {
			...(options.engineArgs === undefined ? {} : { engineArgs: options.engineArgs }),
			...(options.ignoreAttachments === undefined
				? {}
				: { ignoreAttachments: options.ignoreAttachments }),
		});
	const stream = createProcessStream({ command });
	const client = new JsonRpcClient(stream, {
		defaultTimeoutMs: options.defaultTimeoutMs ?? 30_000,
	});
	const backendOptions: SignalCliBackendOptions = options.notificationMethod
		? { account: options.account, notificationMethod: options.notificationMethod }
		: { account: options.account };
	return { backend: new SignalCliBackend(client, backendOptions), client };
}
