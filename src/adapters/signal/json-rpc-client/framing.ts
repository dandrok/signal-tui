/**
 * Turning a byte stream into lines, with a cap.
 *
 * A peer that never sends a newline, or sends a gigabyte of one, must not grow the buffer
 * forever — and after an oversized line is dropped, the rest of it has to be ignored up to the
 * next newline, or its tail parses as a fresh message. Both rules live here, where they are the
 * only thing happening, rather than inside the request bookkeeping.
 *
 * The cap is in UTF-8 bytes: CJK text is 3 bytes per UTF-16 code unit, so counting `length`
 * would admit roughly three times the configured budget.
 */
export interface FramerOptions {
	readonly maxLineBytes: number;
	readonly onLine: (line: string) => void;
	/** Oversized lines, reported with the text that identifies them (or empty when dropped). */
	readonly onError: (error: Error, context: string) => void;
}

export class LineFramer {
	readonly #maxLineBytes: number;
	readonly #onLine: (line: string) => void;
	readonly #onError: (error: Error, context: string) => void;
	#buffer = "";
	#discarding = false;

	constructor(options: FramerOptions) {
		this.#maxLineBytes = options.maxLineBytes;
		this.#onLine = options.onLine;
		this.#onError = options.onError;
	}

	push(chunk: string): void {
		this.#buffer += chunk;

		// After dropping an oversized line we must ignore everything up to the next newline;
		// otherwise the tail of that line would be parsed as a fresh line.
		if (this.#discarding) {
			const delimiter = this.#buffer.indexOf("\n");
			if (delimiter < 0) {
				this.#buffer = "";
				return;
			}
			this.#buffer = this.#buffer.slice(delimiter + 1);
			this.#discarding = false;
		}

		let newlineIndex = this.#buffer.indexOf("\n");
		while (newlineIndex >= 0) {
			// Measure the raw line: the cap applies to what the peer sent, not to whatever
			// survives trimming.
			const rawLine = this.#buffer.slice(0, newlineIndex);
			this.#buffer = this.#buffer.slice(newlineIndex + 1);

			const rawBytes = Buffer.byteLength(rawLine, "utf8");
			if (rawBytes > this.#maxLineBytes) {
				this.#onError(
					new Error(
						`inbound line exceeded ${this.#maxLineBytes} bytes (${rawBytes}); line ignored`,
					),
					rawLine.slice(0, 200),
				);
			} else {
				const line = rawLine.trim();
				if (line.length > 0) {
					this.#onLine(line);
				}
			}

			newlineIndex = this.#buffer.indexOf("\n");
		}

		const bufferedBytes = Buffer.byteLength(this.#buffer, "utf8");
		if (bufferedBytes > this.#maxLineBytes) {
			this.#buffer = "";
			this.#discarding = true;
			this.#onError(
				new Error(
					`inbound line exceeded ${this.#maxLineBytes} bytes (${bufferedBytes} buffered); discarding until newline`,
				),
				"",
			);
		}
	}
}
