#!/usr/bin/env bun
/**
 * Point git at the tracked .githooks directory so hooks travel with the repo
 * (no husky/lefthook dependency). Requires git >= 2.9 for core.hooksPath.
 */

const HOOKS_PATH = ".githooks";
const HOOKS = ["pre-commit", "pre-push"];

const config = Bun.spawnSync(["git", "config", "core.hooksPath", HOOKS_PATH], {
	stdout: "inherit",
	stderr: "inherit",
});

if (config.exitCode !== 0) {
	console.error(`✖ could not set core.hooksPath=${HOOKS_PATH}`);
	process.exit(1);
}

for (const hook of HOOKS) {
	const chmod = Bun.spawnSync(["chmod", "+x", `${HOOKS_PATH}/${hook}`], {
		stdout: "inherit",
		stderr: "inherit",
	});
	if (chmod.exitCode !== 0) {
		console.error(`✖ could not make ${hook} executable`);
		process.exit(1);
	}
}

console.log(`✅ git hooks enabled → ${HOOKS_PATH} (${HOOKS.join(", ")})`);
