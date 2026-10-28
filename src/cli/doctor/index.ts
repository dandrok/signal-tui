/**
 * `doctor` — what is installed, what is linked, and what the cache looks like.
 *
 * The report is assembled from four independent groups so each one can be read, and tested,
 * on its own: `runtime` (bun, signal-cli, java), `account`, `cache`, and the probes that feed
 * them all. This file is the module's public surface; nothing outside imports a file below it.
 */
export { evaluateChecks, hasFailures } from "./checks";
export { collectProbes, processRunner } from "./probes";
export type {
	Check,
	CheckStatus,
	CommandResult,
	CommandRunner,
	Probes,
} from "./types";
export {
	atLeast,
	compareVersions,
	MINIMUM_BUN,
	MINIMUM_JAVA,
	MINIMUM_SIGNAL_CLI,
	parseVersion,
	VERIFIED_SIGNAL_CLI,
	type Version,
} from "./version";
