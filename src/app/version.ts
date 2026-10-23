import pkg from "../../package.json" with { type: "json" };

/**
 * Version shown by `--version`. Read from the manifest so publishing can never
 * disagree with what the binary reports.
 */
export const VERSION: string = pkg.version;
