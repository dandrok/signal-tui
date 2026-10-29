#!/usr/bin/env bun
import { render } from "ink";
import { InMemoryStore } from "./adapters/memory/store";
import { spawnSignalCliBackend } from "./adapters/signal/spawn";
import { SqliteMessageStore } from "./adapters/sqlite/store";
import type { CliConfig } from "./app/config";
import { defaultDbPath, parseArgs, USAGE, UsageError } from "./app/config";
import { formatStartupFailure } from "./app/report";
import type { Session } from "./app/session";
import { createSession } from "./app/session";
import type { Settings } from "./app/settings";
import {
	cacheDefault,
	configPath,
	readSettingsFile,
	resolveSettings,
	SettingsError,
} from "./app/settings";
import { defaultOpenContext } from "./app/usecases/open";
import { VERSION } from "./app/version";
import { ensurePrivateDirectory } from "./cli/paths";
import type { MessageStore } from "./ports/store";
import { Root } from "./ui/Root";

if (typeof Bun === "undefined") {
	console.error(
		"signal-tui requires the Bun runtime.\nInstall it with: curl -fsSL https://bun.sh/install | bash\nDocs: https://bun.sh/docs/installation",
	);
	process.exit(1);
}

let config: CliConfig;
let settings: Settings;
try {
	// The file is read before the flags because it supplies the cache default they override:
	// `flag > env > file > default`, resolved once instead of in every reader.
	const file = readSettingsFile(configPath());
	config = parseArgs(process.argv.slice(2), {
		defaultDbPath: cacheDefault(file, process.env, defaultDbPath()),
	});
	const notify = config.mode === "live" || config.mode === "demo" ? config.notify : undefined;
	const ignoreAttachments =
		config.mode === "live" || config.mode === "demo" ? config.ignoreAttachments : undefined;
	settings = resolveSettings({ file, notify, ignoreAttachments });
} catch (error) {
	if (error instanceof UsageError) {
		console.error(`${error.message}\n\n${USAGE}`);
		process.exit(2);
	}
	if (error instanceof SettingsError) {
		// The file's own message names the path and the setting; a usage dump would bury it.
		console.error(`config: ${error.message}`);
		process.exit(2);
	}
	throw error;
}

if (config.mode === "help") {
	console.log(USAGE);
	process.exit(0);
}

if (config.mode === "version") {
	console.log(`signal-tui ${VERSION}`);
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

async function startLive(account: string, dbPath: string, settings: Settings): Promise<Running> {
	ensurePrivateDirectory(dbPath);
	const store = new SqliteMessageStore({ path: dbPath });

	// Spawning happens here too: a missing signal-cli throws before start(), so
	// both steps share one failure path, and the child is stopped if start fails.
	const session = await (async () => {
		const { backend } = spawnSignalCliBackend({
			account,
			engineArgs: settings.engineArgs,
			ignoreAttachments: settings.ignoreAttachments,
		});
		const opened = createSession({ store, backend });
		try {
			await opened.start();
		} catch (error) {
			await backend.stop().catch(() => undefined);
			throw error;
		}
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
	config.mode === "live"
		? await startLive(config.account, config.dbPath, settings)
		: await startDemo();

const instance = render(
	<Root
		store={running.store}
		session={running.session}
		notify={settings.notify}
		// The engine's own data directory, which `--config` in `engineArgs` may have moved: `o`
		// may only launch files the engine downloaded, so it has to look where the engine writes.
		open={defaultOpenContext(settings.engineArgs)}
	/>,
);

try {
	await instance.waitUntilExit();
} finally {
	await running.dispose();
}
