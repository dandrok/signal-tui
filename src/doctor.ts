#!/usr/bin/env bun
import { defaultDbPath, parseArgs, USAGE, UsageError } from "./app/config";
import { collectProbes, evaluateChecks, hasFailures, processRunner } from "./cli/doctor";

const config = ((): { account?: string | undefined; dbPath: string } => {
	try {
		const parsed = parseArgs(process.argv.slice(2), { defaultDbPath: defaultDbPath() });
		if (parsed.mode === "help") {
			console.log(USAGE);
			process.exit(0);
		}
		if (parsed.mode === "live") {
			return { account: parsed.account, dbPath: parsed.dbPath };
		}
		return { dbPath: defaultDbPath() };
	} catch (error) {
		if (error instanceof UsageError) {
			console.error(`${error.message}\n\n${USAGE}`);
			process.exit(2);
		}
		throw error;
	}
})();

const probes = await collectProbes(processRunner, {
	account: config.account,
	dbPath: config.dbPath,
	bunVersion: Bun.version,
});
const checks = evaluateChecks(probes, { account: config.account });

const symbols = { ok: "✓", warn: "!", fail: "✗" } as const;
for (const check of checks) {
	console.log(`${symbols[check.status]} ${check.name}: ${check.detail}`);
	if (check.hint !== undefined) {
		console.log(`    → ${check.hint}`);
	}
}

if (hasFailures(checks)) {
	console.log("\nsome checks failed; fix them before running live mode");
	process.exit(1);
}

console.log("\nall good — start with:");
console.log(`  bun run src/cli.tsx --account ${config.account ?? "+48..."}`);
