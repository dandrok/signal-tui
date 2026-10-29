import type { Check, Probes } from "../types";
import {
	atLeast,
	compareVersions,
	MINIMUM_BUN,
	MINIMUM_JAVA,
	MINIMUM_SIGNAL_CLI,
	parseVersion,
	VERIFIED_SIGNAL_CLI,
} from "../version";

/**
 * Runtime and engine checks: what has to be installed before anything can start.
 *
 * The Java check never claims a build it cannot see. A working signal-cli means Java is
 * satisfied or unnecessary, and Java only becomes actionable when signal-cli itself fails: a
 * successful version check does not reveal which build is installed, so absent java proves a
 * native build and present java proves nothing.
 *
 * The engine check carries two facts, because one of them is a lie on its own. `>= 0.14.0` says
 * the commands this client uses existed once; it does not say they still answer. signal-cli
 * tracks a protocol that moves, and a release a few months old stops working — so the row also
 * knows which release this build was written against, and says when the installed one is behind
 * it. Older than the baseline is still a failure, older than the verified release is a warning,
 * newer is fine but untested, and the hint says which of those you are looking at.
 */
export function runtimeChecks(probes: Probes): readonly Check[] {
	return [bunCheck(probes), signalCliCheck(probes), javaCheck(probes)];
}

function bunCheck(probes: Probes): Check {
	const ok = atLeast(parseVersion(probes.bunVersion), MINIMUM_BUN);
	return {
		name: "bun runtime",
		status: ok ? "ok" : "warn",
		detail: `Bun ${probes.bunVersion}`,
		hint: ok ? undefined : `the project targets Bun >= ${MINIMUM_BUN.join(".")}`,
	};
}

function signalCliCheck(probes: Probes): Check {
	const reported = probes.signalCliVersion;
	if (reported === null) {
		return probes.signalCliError === null
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
				};
	}

	const installed = parseVersion(reported);
	if (!atLeast(installed, MINIMUM_SIGNAL_CLI) || installed === null) {
		return {
			name: "signal-cli",
			status: "fail",
			detail: `${reported} is older than ${MINIMUM_SIGNAL_CLI.slice(0, 2).join(".")}`,
			hint: "upgrade: releases older than ~3 months stop working as Signal changes",
		};
	}

	const verified = VERIFIED_SIGNAL_CLI.join(".");
	const against = compareVersions(installed, VERIFIED_SIGNAL_CLI);
	if (against === 0) {
		return { name: "signal-cli", status: "ok", detail: reported };
	}
	if (against > 0) {
		return {
			name: "signal-cli",
			status: "ok",
			detail: `${reported} (newer than ${verified})`,
			hint: `this build was written against ${verified}: if something breaks, a protocol change is the first thing to suspect`,
		};
	}
	return {
		name: "signal-cli",
		status: "warn",
		detail: `${reported} (older than ${verified})`,
		hint: `this build was verified against ${verified}. Releases older than about three months stop working — upgrade before it fails mid-conversation`,
	};
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
