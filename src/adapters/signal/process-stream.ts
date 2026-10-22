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
 *
 * Two ordering rules matter here:
 *  - one `TextDecoder` per pipe, because a decoder carries partial multi-byte
 *    state and mixing stdout with stderr corrupts UTF-8;
 *  - `close` is emitted only after the process exited *and* both pipes drained,
 *    otherwise the final response line would be dropped.
 */
export function createProcessStream(options: ProcessStreamOptions): RpcStream {
	const dataHandlers = new Set<(chunk: string) => void>();
	const closeHandlers = new Set<(reason?: string) => void>();
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

	const appendStderr = (text: string): void => {
		// stderrLimitBytes is a *byte* limit: encode once, keep the trailing byte
		// window, and skip leading continuation bytes so we never split a code point.
		const bytes = Buffer.from(`${stderr}${text}`, "utf8");
		let start = Math.max(0, bytes.length - stderrLimit);
		while (start < bytes.length && ((bytes[start] ?? 0) & 0xc0) === 0x80) {
			start++;
		}
		stderr = bytes.subarray(start).toString("utf8");
	};

	const emitData = (chunk: string): void => {
		for (const handler of dataHandlers) {
			try {
				handler(chunk);
			} catch (error) {
				appendStderr(
					`\n[data handler threw] ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}
	};

	const emitClose = (reason?: string): void => {
		if (closed) {
			return;
		}
		closed = true;
		for (const handler of closeHandlers) {
			try {
				handler(reason);
			} catch {
				// A close handler must not abort close notification for the others,
				// nor reject the detached process-completion chain.
			}
		}
		closeHandlers.clear();
		dataHandlers.clear();
	};

	const pump = async (
		stream: ReadableStream<Uint8Array>,
		onText: (text: string) => void,
	): Promise<void> => {
		const decoder = new TextDecoder();
		const reader = stream.getReader();
		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) {
					const tail = decoder.decode();
					if (tail.length > 0) {
						onText(tail);
					}
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

	const drained = Promise.all([pump(child.stdout, emitData), pump(child.stderr, appendStderr)]);

	void Promise.all([child.exited, drained])
		.then(([code]) => {
			emitClose(stderr.trim() || `process exited with code ${code}`);
		})
		.catch((error: unknown) => {
			emitClose(error instanceof Error ? error.message : String(error));
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
