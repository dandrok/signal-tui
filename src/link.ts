#!/usr/bin/env bun
import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	buildQrPlan,
	LINK_USAGE,
	linkInstructions,
	parseLinkArgs,
	parseLinkLine,
	QR_UNAVAILABLE_HELP,
} from "./cli/linking";

const argv = process.argv.slice(2);

if (argv.includes("--help") || argv.includes("-h")) {
	console.log(LINK_USAGE);
	process.exit(0);
}

const name = ((): string => {
	try {
		return parseLinkArgs(argv);
	} catch (error) {
		console.error(`${error instanceof Error ? error.message : String(error)}\n\n${LINK_USAGE}`);
		process.exit(2);
	}
})();

const signalCli = Bun.which("signal-cli");
if (signalCli === null) {
	console.error("signal-cli was not found on PATH.\nbun run doctor reports what is missing.");
	process.exit(1);
}

const directory = mkdtempSync(join(tmpdir(), "signal-tui-link-"));
const cleanup = (): void => {
	rmSync(directory, { recursive: true, force: true });
};

const openWithSystemViewer = (path: string): void => {
	const opener = process.platform === "darwin" ? "open" : "xdg-open";
	try {
		Bun.spawn([opener, path], { stdout: "ignore", stderr: "ignore" });
	} catch {
		// The path is printed anyway, so a missing opener is not fatal.
	}
};

const showQr = (uri: string): void => {
	const qrencode = Bun.which("qrencode");
	if (qrencode === null) {
		console.log(`\nlink URI:\n  ${uri}\n\n${QR_UNAVAILABLE_HELP}`);
		return;
	}

	const plan = buildQrPlan(uri, join(directory, "link.png"));
	const result = Bun.spawnSync({
		cmd: [qrencode, ...plan.argv.slice(1)],
		// The URI is a credential: as an argument it would be readable from
		// /proc/<pid>/cmdline by any local user while qrencode runs.
		stdin: Buffer.from(plan.input),
		stdout: "pipe",
		stderr: "pipe",
	});
	if (result.exitCode === 0) {
		// The image encodes the link credential: keep it private to this user.
		try {
			chmodSync(plan.path, 0o600);
		} catch {
			// Non-POSIX filesystem; the 0700 temp directory still restricts access.
		}
	}

	if (result.exitCode !== 0) {
		console.error(`qrencode failed: ${result.stderr.toString().trim()}`);
		console.log(`\nlink URI:\n  ${uri}`);
		return;
	}

	console.log(`\nQR image: ${plan.path}`);
	console.log("scan it: Signal → Settings → Linked devices → Link new device");
	console.log("keep this running until the phone confirms.\n");
	openWithSystemViewer(plan.path);
};

console.log(`linking a new device named "${name}"…`);

const child = Bun.spawn([signalCli, "link", "-n", name], {
	stdout: "pipe",
	stderr: "inherit",
	stdin: "inherit",
});

// The temporary image is a credential: remove it even when interrupted.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.on(signal, () => {
		child.kill();
		cleanup();
		process.exit(130);
	});
}

const decoder = new TextDecoder();
let buffer = "";
let linkedNumber: string | null = null;

for await (const chunk of child.stdout) {
	buffer += decoder.decode(chunk, { stream: true });

	let newline = buffer.indexOf("\n");
	while (newline !== -1) {
		const line = buffer.slice(0, newline);
		buffer = buffer.slice(newline + 1);
		const event = parseLinkLine(line);

		if (event?.kind === "uri") {
			showQr(event.value);
		} else if (event?.kind === "linked") {
			linkedNumber = event.value;
		}

		newline = buffer.indexOf("\n");
	}
}

const exitCode = await child.exited;
cleanup();

if (linkedNumber !== null) {
	console.log(`\n${linkInstructions(linkedNumber)}`);
	process.exit(0);
}

if (exitCode === 0) {
	console.log("\nthe link session ended without a confirmation from the phone.");
} else {
	console.error(`\nsignal-cli link exited with code ${exitCode}`);
}
process.exit(1);
