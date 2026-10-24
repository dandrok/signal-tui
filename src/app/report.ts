/**
 * Turning a startup failure into something a person can act on. Kept pure and
 * separate from `cli.tsx` because the interesting part is the decision, not the
 * console call.
 */
export function formatStartupFailure(account: string, error: unknown): string {
	const raw = error instanceof Error ? error.message : String(error);
	const detail = (raw.split("\n")[0] ?? raw).trim();
	const lines = [`could not start signal-cli for ${account}: ${detail}`];

	if (/ENOENT|not found/i.test(raw)) {
		lines.push("signal-cli was not found on PATH — install 0.14 or newer, then link your account");
	}
	// `doctor` ships as a file, not as a subcommand, so it is only reachable from a
	// clone; the setup guide is the one pointer that works for an installed copy too.
	lines.push(
		`setup guide: https://github.com/dandrok/signal-tui/blob/main/SETUP.md#troubleshooting`,
	);
	lines.push(`from a clone, diagnostics: bun run doctor -- --account ${account}`);

	return lines.join("\n");
}
