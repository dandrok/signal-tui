import type { RpcStream } from "./rpc-stream";

export interface ProcessStreamOptions {
	readonly command: readonly string[];
	readonly cwd?: string;
	readonly env?: Readonly<Record<string, string>>;
	/** How many stderr bytes to keep for the close reason. */
	readonly stderrLimitBytes?: number;
}

/**
 * Wraps a child process's stdio as an {@link RpcStream}.
 *
 * Deliberately thin: all protocol logic lives in `JsonRpcClient`, which is
 * tested against an in-memory stream. This adapter is exercised end-to-end by
 * the integration test that runs a real `signal-cli` binary.
 */
export function createProcessStream(options: ProcessStreamOptions): RpcStream {
	const dataHandlers = new Set<(chunk: string) => void>();
	const closeHandlers = new Set<(reason?: string) => void>();
	const decoder = new TextDecoder();
	const stderrLimit = options.stderrLimitBytes ?? 4096;

	const env: Record<string, string> = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (typeof value === "string") {
			env[key] = value;
		}
	}
	Object.assign(env, options.env ?? {});

	const child = Bun.spawn([...options.command], {
		cwd: options.cwd ?? process.cwd(),
		env,
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
	});

	let stderr = "";
	let closed = false;

	const emitData = (chunk: string): void => {
		for (const handler of dataHandlers) {
			handler(chunk);
		}
	};

	const emitClose = (reason?: string): void => {
		if (closed) {
			return;
		}
		closed = true;
		for (const handler of closeHandlers) {
			handler(reason);
		}
		closeHandlers.clear();
		dataHandlers.clear();
	};

	const pump = async (stream: ReadableStream<Uint8Array>, onText: (text: string) => void) => {
		const reader = stream.getReader();
		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) {
					return;
				}
				if (value !== undefined) {
					onText(decoder.decode(value, { stream: true }));
				}
			}
		} finally {
			reader.releaseLock();
		}
	};

	void pump(child.stdout, emitData);
	void pump(child.stderr, (text) => {
		stderr = `${stderr}${text}`.slice(-stderrLimit);
	});
	void child.exited.then((code) => {
		emitClose(stderr.trim() || `process exited with code ${code}`);
	});

	return {
		write(line: string): void {
			if (closed) {
				throw new Error("stream is closed");
			}
			child.stdin.write(`${line}\n`);
			child.stdin.flush();
		},
		onData(handler) {
			dataHandlers.add(handler);
			return () => {
				dataHandlers.delete(handler);
			};
		},
		onClose(handler) {
			closeHandlers.add(handler);
			return () => {
				closeHandlers.delete(handler);
			};
		},
		close(reason?: string): void {
			if (closed) {
				return;
			}
			child.kill();
			emitClose(reason ?? "closed by client");
		},
	};
}
