import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const LINK = join(import.meta.dir, "..", "src", "link.ts");
const BUN = process.execPath;
const BUN_DIR = dirname(BUN);
const URI = "sgnl://linkdevice?uuid=stub-uuid&pub_key=stub-key&capabilities=";
const NUMBER = "+48123456789";

/**
 * Both executables are stubs on PATH: this exercises `src/link.ts` end to end
 * (spawn, parse, render, report) without signal-cli, qrencode or a phone.
 * The qrencode stub records its argv and its stdin, which is where the "URI must
 * not be an argument" guarantee actually lives.
 */
const stubDirectory = (): string => {
	// Not os.tmpdir(): /tmp is mounted noexec on some systems, and these are
	// executables by design.
	const dir = join(import.meta.dir, "..", `.tmp-linktest-${randomUUID().slice(0, 8)}`);
	mkdirSync(dir, { recursive: true });

	const signalCli = `#!/bin/sh
echo '${URI}'
echo 'Associated with: ${NUMBER}'
`;
	const qrencode = `#!/bin/sh
printf '%s\\n' "$*" > "$STUB_DIR/qrencode.args"
cat > "$STUB_DIR/qrencode.stdin"
out=""
prev=""
for a in "$@"; do
  if [ "$prev" = "-o" ]; then out="$a"; fi
  prev="$a"
done
printf 'PNG' > "$STUB_DIR/rendered"
if [ -n "$out" ]; then printf 'PNG' > "$out"; fi
`;
	for (const [name, body] of [
		["signal-cli", signalCli],
		["qrencode", qrencode],
	] as const) {
		const path = join(dir, name);
		writeFileSync(path, body);
		chmodSync(path, 0o755);
	}
	return dir;
};

describe.skipIf(process.platform === "win32")("bun run link", () => {
	test("feeds the URI to qrencode on stdin and reports the linked number", async () => {
		const stubs = stubDirectory();
		const cache = mkdtempSync(join(tmpdir(), "signal-tui-linkcache-"));

		try {
			const child = Bun.spawn([BUN, "run", LINK, "--name", "stub-device"], {
				cwd: join(import.meta.dir, ".."),
				env: {
					...process.env,
					PATH: `${stubs}:${BUN_DIR}:/usr/bin:/bin`,
					TMPDIR: cache,
					STUB_DIR: stubs,
				},
				stdout: "pipe",
				stderr: "pipe",
			});

			const [stdout, exitCode] = await Promise.all([
				new Response(child.stdout).text(),
				child.exited,
			]);

			expect(exitCode).toBe(0);
			expect(stdout).toContain(`linked as ${NUMBER}`);
			expect(stdout).toContain(`--account ${NUMBER}`);

			// qrencode really ran, received the URI on stdin...
			const stdinSeen = readFileSync(join(stubs, "qrencode.stdin"), "utf8");
			expect(stdinSeen).toBe(URI);

			// ...and never as an argument, which /proc would expose to other users.
			const args = readFileSync(join(stubs, "qrencode.args"), "utf8");
			expect(args).not.toContain("sgnl://");
			expect(args).toContain("-o");
			expect(existsSync(join(stubs, "rendered"))).toBe(true);
		} finally {
			rmSync(stubs, { recursive: true, force: true });
			rmSync(cache, { recursive: true, force: true });
		}
	}, 20_000);

	test("fails with a usage error on an unknown option", async () => {
		const child = Bun.spawn([BUN, "run", LINK, "--nmae", "typo"], {
			cwd: join(import.meta.dir, ".."),
			env: { ...process.env, PATH: `${BUN_DIR}:/usr/bin:/bin` },
			stdout: "pipe",
			stderr: "pipe",
		});

		const [stderr, exitCode] = await Promise.all([new Response(child.stderr).text(), child.exited]);

		expect(exitCode).toBe(2);
		expect(stderr).toContain("unknown option: --nmae");
	}, 20_000);
});
