import { describe, expect, test } from "bun:test";
import {
	cacheDefault,
	configPath,
	parseSettingsFile,
	readSettingsFile,
	resolveSettings,
	SettingsError,
} from "../src/app/settings";

/**
 * The config file is the one place a user's typo outlives the shell that made it, so what is
 * tested here is mostly refusal: an unknown key, a value of the wrong type, a file that is not
 * an object. Each of those has to say which setting and which file, or it reads as "the binary
 * is broken".
 *
 * Precedence is the other half: `flag > env > file > default`, with "the flag was not given"
 * kept distinct from "the flag said false".
 */

const PATH = "/home/someone/.config/signal-tui/config.json";

const parse = (text: string) => parseSettingsFile(text, PATH);
const refuse = (text: string): string => {
	try {
		parse(text);
	} catch (error) {
		return (error as Error).message;
	}
	throw new Error("expected a refusal");
};

describe("the config file", () => {
	test("reads the settings it knows", () => {
		expect(
			parse(
				'{"notify": false, "ignoreAttachments": true, "db": "/tmp/cache.db", "engineArgs": ["--config", "/etc/sc"]}',
			),
		).toEqual({
			notify: false,
			ignoreAttachments: true,
			db: "/tmp/cache.db",
			engineArgs: ["--config", "/etc/sc"],
		});
	});

	test("an empty object is a file with no opinion, not a file with defaults", () => {
		// Absent keys are what let the environment and the code defaults have their say.
		expect(parse("{}")).toEqual({});
	});

	test("refuses an unknown setting instead of ignoring it", () => {
		// A silently ignored key is how a typo becomes "the config does not work".
		const message = refuse('{"notifiy": true}');
		expect(message).toContain("notifiy");
		expect(message).toContain(PATH);
		expect(message).toContain("notify");
	});

	test("refuses a value of the wrong type, naming the setting", () => {
		expect(refuse('{"notify": "off"}')).toContain("notify");
		expect(refuse('{"notify": 0}')).toContain("notify");
		expect(refuse('{"ignoreAttachments": "yes"}')).toContain("ignoreAttachments");
		expect(refuse('{"db": ""}')).toContain("db");
		expect(refuse('{"db": 42}')).toContain("db");
		expect(refuse('{"engineArgs": "--config"}')).toContain("engineArgs");
		expect(refuse('{"engineArgs": ["--config", 7]}')).toContain("engineArgs");
	});

	test("refuses JSON that is not an object, and says which file", () => {
		expect(refuse("[]")).toContain(PATH);
		expect(refuse('"notify"')).toContain(PATH);
		expect(refuse("{ nope")).toContain("not valid JSON");
	});
});

describe("reading the file", () => {
	test("a missing file is not an error: most runs have none", () => {
		const missing = (): string => {
			throw Object.assign(new Error("no such file"), { code: "ENOENT" });
		};

		expect(readSettingsFile(PATH, missing)).toEqual({});
	});

	test("a file that cannot be read is an error, not a silent fallback", () => {
		const denied = (): string => {
			throw Object.assign(new Error("permission denied"), { code: "EACCES" });
		};

		expect(() => readSettingsFile(PATH, denied)).toThrow(SettingsError);
	});

	test("what it reads is what it parses", () => {
		expect(readSettingsFile(PATH, () => '{"notify": true}')).toEqual({ notify: true });
	});
});

describe("where the file lives", () => {
	test("XDG_CONFIG_HOME wins, and ~/.config is the fallback", () => {
		expect(configPath({ XDG_CONFIG_HOME: "/xdg" }, "/home/someone")).toBe(
			"/xdg/signal-tui/config.json",
		);
		expect(configPath({}, "/home/someone")).toBe("/home/someone/.config/signal-tui/config.json");
		// An empty variable is how a shell says "unset"; it must not become the relative path.
		expect(configPath({ XDG_CONFIG_HOME: "  " }, "/home/someone")).toBe(
			"/home/someone/.config/signal-tui/config.json",
		);
	});
});

describe("the cache location", () => {
	test("the environment beats the file, and both beat the default", () => {
		const file = { db: "/file/cache.db" };

		expect(cacheDefault(file, { SIGNAL_TUI_DB: "/env/cache.db" }, "/default/cache.db")).toBe(
			"/env/cache.db",
		);
		expect(cacheDefault(file, {}, "/default/cache.db")).toBe("/file/cache.db");
		expect(cacheDefault({}, {}, "/default/cache.db")).toBe("/default/cache.db");
	});
});

describe("what a run settles on", () => {
	test("notification on, by default", () => {
		expect(resolveSettings({ file: {}, env: {} })).toEqual({
			notify: true,
			ignoreAttachments: false,
			engineArgs: [],
		});
	});

	test("attachments are downloaded by default, and the flag beats env beats file", () => {
		// The engine writes every received file to its own directory unless told otherwise, so
		// the default is the behaviour the user already has.
		expect(resolveSettings({ file: {}, env: {} }).ignoreAttachments).toBe(false);

		expect(resolveSettings({ file: { ignoreAttachments: true }, env: {} }).ignoreAttachments).toBe(
			true,
		);
		expect(
			resolveSettings({
				file: { ignoreAttachments: false },
				env: { SIGNAL_TUI_IGNORE_ATTACHMENTS: "on" },
			}).ignoreAttachments,
		).toBe(true);
		expect(
			resolveSettings({
				file: { ignoreAttachments: true },
				env: { SIGNAL_TUI_IGNORE_ATTACHMENTS: "on" },
				ignoreAttachments: false,
			}).ignoreAttachments,
		).toBe(false);
	});

	test("the flag beats the environment, which beats the file", () => {
		const file = { notify: true };

		// The flag was given: no environment or file can outvote it.
		expect(resolveSettings({ file, env: { SIGNAL_TUI_NOTIFY: "on" }, notify: false }).notify).toBe(
			false,
		);
		// No flag: the environment speaks for one run, the file for every run.
		expect(resolveSettings({ file, env: { SIGNAL_TUI_NOTIFY: "off" } }).notify).toBe(false);
		expect(resolveSettings({ file: { notify: false }, env: {} }).notify).toBe(false);
	});

	test("SIGNAL_TUI_NOTIFY reads words, not just digits", () => {
		for (const off of ["0", "off", "false", "no", " OFF "]) {
			expect(resolveSettings({ file: {}, env: { SIGNAL_TUI_NOTIFY: off } }).notify).toBe(false);
		}
		for (const on of ["1", "on", "true", "yes"]) {
			expect(
				resolveSettings({ file: { notify: false }, env: { SIGNAL_TUI_NOTIFY: on } }).notify,
			).toBe(true);
		}
		// A value nobody can interpret is refused rather than read as "on".
		expect(() => resolveSettings({ file: {}, env: { SIGNAL_TUI_NOTIFY: "maybe" } })).toThrow(
			SettingsError,
		);
	});

	test("engine arguments come from the file only, since they are a standing preference", () => {
		const settings = resolveSettings({ file: { engineArgs: ["--config", "/etc/sc"] }, env: {} });

		expect(settings.engineArgs).toEqual(["--config", "/etc/sc"]);
	});
});
