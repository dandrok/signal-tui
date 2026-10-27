const MAX_PROTOCOL_ERRORS = 20;

/**
 * Why a message did not arrive, kept for `doctor`-style reporting without ever growing.
 *
 * Bounded to the last twenty: a peer that sends garbage in a loop must not turn a diagnostic
 * into a memory leak, and twenty lines is enough to see the shape of the problem.
 */
export class ProtocolErrorLog {
	readonly #items: string[] = [];

	get entries(): readonly string[] {
		return this.#items;
	}

	record(message: string): void {
		this.#items.push(message);
		if (this.#items.length > MAX_PROTOCOL_ERRORS) {
			this.#items.shift();
		}
	}
}
