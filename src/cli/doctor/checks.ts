import { accountCheck } from "./checks/account";
import { cacheChecks } from "./checks/cache";
import { runtimeChecks } from "./checks/runtime";
import type { Check, Probes } from "./types";

/**
 * The whole report, in the order a user reads it: can it run, is the account linked, can it
 * keep a cache. Each group knows its own advice; this only decides the order.
 */
export function evaluateChecks(
	probes: Probes,
	options: { readonly account?: string | undefined },
): readonly Check[] {
	return [
		...runtimeChecks(probes),
		...accountCheck(probes, options.account),
		...cacheChecks(probes),
	];
}

/** One failure is enough to refuse to start; a warning never is. */
export function hasFailures(checks: readonly Check[]): boolean {
	return checks.some((check) => check.status === "fail");
}
