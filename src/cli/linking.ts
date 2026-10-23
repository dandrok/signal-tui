/**
 * Linking a new device to an existing Signal account.
 *
 * `signal-cli link` prints the QR as Unicode block art. The GraalVM native build
 * comes with a US-ASCII-only charset, so it writes literal `?` bytes instead of
 * the block glyphs — verified by hexdumping its output under a pty, and
 * `-Dfile.encoding=UTF-8` does not change it (the tables are not in the image).
 * The font and locale are irrelevant; the art cannot be rendered at all.
 *
 * The same command prints the `sgnl://linkdevice?…` URI as plain text on the line
 * before, so we render a real image from that instead.
 */

export interface LinkEvent {
	readonly kind: "uri" | "linked";
	readonly value: string;
}

const URI_PREFIX = "sgnl://";
const ASSOCIATED_PREFIX = "Associated with:";

/**
 * Parses one line of `signal-cli link` output. Everything else (QR block art,
 * progress noise) is ignored, so callers never have to echo the raw output.
 */
export function parseLinkLine(line: string): LinkEvent | null {
	const trimmed = line.trim();

	if (trimmed.startsWith(URI_PREFIX)) {
		return { kind: "uri", value: trimmed.split(/\s/)[0] ?? trimmed };
	}
	if (trimmed.startsWith(ASSOCIATED_PREFIX)) {
		const number = trimmed.slice(ASSOCIATED_PREFIX.length).trim();
		return number.length > 0 ? { kind: "linked", value: number } : null;
	}
	return null;
}

export const QR_UNAVAILABLE_HELP = `the QR could not be rendered as an image.

Your terminal font may not draw the block characters signal-cli uses, and
"qrencode" is what turns the link URI into a scannable PNG.

Install it and retry:
  sudo pacman -S qrencode        # Arch
  sudo apt install qrencode      # Debian/Ubuntu
  brew install qrencode          # macOS`;

export interface QrPlan {
	readonly argv: readonly string[];
	readonly path: string;
	/** Written to qrencode's stdin: command lines are world-readable via /proc. */
	readonly input: string;
}

/** Command that turns the link URI into a PNG the system image viewer can open. */
export function buildQrPlan(uri: string, path: string): QrPlan {
	return {
		argv: ["qrencode", "-t", "PNG", "-s", "8", "-m", "2", "-o", path],
		path,
		input: uri,
	};
}

export const LINK_NAME_DEFAULT = "signal-tui";

const assertName = (value: string | undefined): string => {
	// An option token is not a name: `--name --verbose` must not swallow the flag.
	if (value === undefined || value.trim().length === 0 || value.startsWith("-")) {
		throw new Error("--name needs a device name");
	}
	return value;
};

/** Strict on purpose: a typo like `--nmae` must not silently link under the default name. */
export function parseLinkArgs(argv: readonly string[]): string {
	let name = LINK_NAME_DEFAULT;

	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index] ?? "";

		if (arg === "--name") {
			name = assertName(argv[index + 1]);
			index++;
			continue;
		}
		if (arg.startsWith("--name=")) {
			name = assertName(arg.slice("--name=".length));
			continue;
		}
		throw new Error(`unknown option: ${arg}`);
	}

	return name;
}

export const LINK_USAGE = `usage: bun run link [--name <device name>]

Links this computer to your Signal account by rendering the link QR as an image.

  --name <device>   how the device appears in Signal → Linked devices
                    (default: ${LINK_NAME_DEFAULT})`;

export const linkInstructions = (number: string): string =>
	[
		`linked as ${number}`,
		"",
		"start the client with:",
		`  bun run src/cli.tsx --account ${number}`,
		"",
		`remove this device any time from Signal → Linked devices.`,
	].join("\n");
