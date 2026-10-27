/** What a probe command reported. Injected so the doctor is testable without spawning. */
export interface CommandResult {
	readonly code: number;
	readonly stdout: string;
	readonly stderr: string;
}

export interface CommandRunner {
	run(argv: readonly string[]): Promise<CommandResult>;
}

export interface Probes {
	readonly bunVersion: string;
	readonly signalCliVersion: string | null;
	/** Why `signal-cli --version` failed, when it ran but did not succeed. */
	readonly signalCliError: string | null;
	readonly javaVersion: string | null;
	/** Account numbers reported by `signal-cli listAccounts`, or null if it failed. */
	readonly accounts: readonly string[] | null;
	readonly dbWritable: boolean;
	readonly dbPath: string;
	/** True when the cache (if it exists) is readable by group or others. */
	readonly dbExposed: boolean;
	/** True when other users can write to the cache directory. */
	readonly dbDirExposed: boolean;
}

export type CheckStatus = "ok" | "warn" | "fail";

export interface Check {
	readonly name: string;
	readonly status: CheckStatus;
	readonly detail: string;
	readonly hint?: string | undefined;
}
