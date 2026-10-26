/**
 * Wait until something is observable, rather than for a fixed number of milliseconds.
 *
 * Ink and React flush on their own schedule, so a sleep either wastes time or races the
 * scheduler. Polling a predicate says what the test actually needs — "this write happened"
 * — and fails with a message instead of a mystery assertion further down.
 */
export async function waitFor(
	check: () => boolean,
	description = "condition",
	timeoutMs = 2_000,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!check()) {
		if (Date.now() > deadline) {
			throw new Error(`waitFor: ${description} did not happen within ${timeoutMs}ms`);
		}
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}
