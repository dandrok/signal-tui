import type { Check, Probes } from "../types";
import { atLeast, MINIMUM_BUN, MINIMUM_JAVA, MINIMUM_SIGNAL_CLI, parseVersion } from "../version";

/**
 * Runtime and engine checks: what has to be installed before anything can start.
 *
 * The Java check never claims a build it cannot see. A working signal-cli means Java is
 * satisfied or unnecessary, and Java only becomes actionable when signal-cli itself fails: a
 * successful version check does not reveal which build is installed, so absent java proves a
 * native build and present java proves nothing.
 */
export function runtimeChecks(probes: Probes): readonly Check[] {
	const checks: Check[] = [];
	const bunOk = atLeast(parseVersion(probes.bunVersion), MINIMUM_BUN);

	checks.push({
		name: "bun runtime",
		status: bunOk ? "ok" : "warn",
		detail: `Bun ${probes.bunVersion}`,
		hint: bunOk ? undefined : `the project targets Bun >= ${MINIMUM_BUN.join(".")}`,
	});

	if (probes.signalCliVersion === null) {
		checks.push(
			probes.signalCliError === null
				? {
						name: "signal-cli",
						status: "fail",
						detail: "not found on PATH",
						hint: "install signal-cli 0.14 or newer: https://github.com/AsamK/signal-cli#installation",
					}
				: {
						name: "signal-cli",
						status: "fail",
						detail: `found but failed to run: ${probes.signalCliError}`,
						hint: "run it directly to see the full error (that is not a missing binary)",
					},
		);
	} else if (!atLeast(parseVersion(probes.signalCliVersion), MINIMUM_SIGNAL_CLI)) {
		checks.push({
			name: "signal-cli",
			status: "fail",
			detail: `${probes.signalCliVersion} is older than ${MINIMUM_SIGNAL_CLI.slice(0, 2).join(".")}`,
			hint: "upgrade: releases older than ~3 months stop working as Signal changes",
		});
	} else {
		checks.push({ name: "signal-cli", status: "ok", detail: probes.signalCliVersion });
	}

	checks.push(javaCheck(probes));
	return checks;
}

function javaCheck(probes: Probes): Check {
	const javaOk = atLeast(parseVersion(probes.javaVersion), MINIMUM_JAVA);
	if (probes.signalCliVersion !== null) {
		return {
			name: "java",
			status: "ok",
			detail:
				probes.javaVersion === null
					? "not installed — signal-cli runs without it"
					: probes.javaVersion,
		};
	}
	if (probes.javaVersion === null) {
		return {
			name: "java",
			status: "warn",
			detail: "not found on PATH",
			hint: `a JVM signal-cli needs JRE ${MINIMUM_JAVA[0]}+; the native build needs none`,
		};
	}
	return javaOk
		? { name: "java", status: "ok", detail: probes.javaVersion }
		: {
				name: "java",
				status: "warn",
				detail: probes.javaVersion,
				hint: `a JVM signal-cli needs JRE ${MINIMUM_JAVA[0]}+; the native build needs none`,
			};
}
