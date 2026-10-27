import type { Check, Probes } from "../types";

/**
 * The linked account, when one was asked for.
 *
 * "Could not list" and "listed, but it is not there" are different failures with different
 * fixes, so the detail says which one happened instead of collapsing both into "not linked".
 */
export function accountCheck(probes: Probes, account: string | undefined): readonly Check[] {
	if (account === undefined) {
		return [];
	}
	const linked = probes.accounts?.includes(account) ?? false;
	return [
		{
			name: "linked account",
			status: linked ? "ok" : "fail",
			detail: linked
				? account
				: probes.accounts === null
					? "could not list accounts"
					: probes.accounts.length === 0
						? `no accounts linked (wanted ${account})`
						: `not linked (have ${probes.accounts.join(", ")})`,
			hint: linked ? undefined : "link it with: signal-cli link -n signal-tui",
		},
	];
}
