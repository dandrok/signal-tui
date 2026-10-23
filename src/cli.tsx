import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { render } from "ink";
import { InMemoryStore } from "./adapters/memory/store";
import { spawnSignalCliBackend } from "./adapters/signal/signal-cli-backend";
import { SqliteMessageStore } from "./adapters/sqlite/store";
import type { CliConfig } from "./app/config";
import { defaultDbPath, parseArgs, USAGE, UsageError } from "./app/config";
import { formatStartupFailure } from "./app/report";
import type { Session } from "./app/session";
import { createSession } from "./app/session";
import type { MessageStore } from "./ports/store";
import { Root } from "./ui/Root";

if (typeof Bun === "undefined") {
	console.error(
		"signal-tui requires the Bun runtime.\nInstall it with: curl -fsSL https://bun.sh/install | bash\nDocs: https://bun.sh/docs/installation",
	);
	process.exit(1);
}

let config: CliConfig;
try {
	config = parseArgs(process.argv.slice(2), { defaultDbPath: defaultDbPath() });
} catch (error) {
	if (error instanceof UsageError) {
		console.error(`${error.message}\n\n${USAGE}`);
		process.exit(2);
	}
	throw error;
}

if (config.mode === "help") {
	console.log(USAGE);
	process.exit(0);
}

interface Running {
	readonly store: MessageStore;
	readonly session: Session | undefined;
	readonly dispose: () => Promise<void>;
}

async function startDemo(): Promise<Running> {
	return { store: new InMemoryStore(), session: undefined, dispose: async () => undefined };
}

async function startLive(account: string, dbPath: string): Promise<Running> {
	mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 });
	const store = new SqliteMessageStore({ path: dbPath });

	// Spawning happens here too: a missing signal-cli throws before start(), so
	// both steps share one failure path.
	const session = await (async () => {
		const { backend } = spawnSignalCliBackend({ account });
		const opened = createSession({ store, backend });
		await opened.start();
		return opened;
	})().catch((error: unknown) => {
		store.close();
		console.error(formatStartupFailure(account, error));
		process.exit(1);
	});

	return {
		store,
		session,
		dispose: async () => {
			await session.stop();
			store.close();
		},
	};
}

const running =
	config.mode === "live" ? await startLive(config.account, config.dbPath) : await startDemo();

const instance = render(<Root store={running.store} session={running.session} />);

try {
	await instance.waitUntilExit();
} finally {
	await running.dispose();
}
