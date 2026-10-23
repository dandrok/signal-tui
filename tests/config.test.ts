import { describe, expect, test } from "bun:test";
import { defaultDbPath, parseArgs, UsageError } from "../src/app/config";

const parse = (argv: readonly string[]) => parseArgs(argv, { defaultDbPath: "/tmp/cache.db" });

describe("parseArgs", () => {
	test("prints usage when given nothing", () => {
		expect(parse([])).toEqual({ mode: "help" });
	});

	test("understands --help and -h", () => {
		expect(parse(["--help"])).toEqual({ mode: "help" });
		expect(parse(["-h"])).toEqual({ mode: "help" });
	});

	test("understands --version and -v", () => {
		expect(parse(["--version"])).toEqual({ mode: "version" });
		expect(parse(["-v"])).toEqual({ mode: "version" });
	});

	test("selects demo mode", () => {
		expect(parse(["--demo"])).toEqual({ mode: "demo" });
	});

	test("selects live mode with the account and default database", () => {
		expect(parse(["--account", "+48123456789"])).toEqual({
			mode: "live",
			account: "+48123456789",
			dbPath: "/tmp/cache.db",
		});
	});

	test("accepts --flag=value forms", () => {
		expect(parse(["--account=+48123456789", "--db=/tmp/other.db"])).toEqual({
			mode: "live",
			account: "+48123456789",
			dbPath: "/tmp/other.db",
		});
	});

	test("does not care about option order", () => {
		expect(parse(["--db", "/tmp/other.db", "--account", "+48123456789"])).toEqual({
			mode: "live",
			account: "+48123456789",
			dbPath: "/tmp/other.db",
		});
	});

	test("refuses to mix demo and live", () => {
		expect(() => parse(["--demo", "--account", "+48123456789"])).toThrow(UsageError);
	});

	test("rejects an unknown option instead of ignoring it", () => {
		expect(() => parse(["--live"])).toThrow(UsageError);
	});

	test("rejects a malformed account", () => {
		for (const bad of ["48123456789", "+48abc", "+", ""]) {
			expect(() => parse(["--account", bad])).toThrow(UsageError);
		}
	});

	test("rejects a flag without its value", () => {
		expect(() => parse(["--account"])).toThrow(UsageError);
		expect(() => parse(["--db"])).toThrow(UsageError);
	});

	test("rejects an empty database path", () => {
		// An empty path makes SQLite open a private temp database: the cache would
		// silently stop persisting.
		expect(() => parse(["--db", ""])).toThrow(UsageError);
		expect(() => parse(["--db="])).toThrow(UsageError);
		expect(() => parse(["--db", "   "])).toThrow(UsageError);
	});

	test("rejects an in-memory database, which would lose the cache on exit", () => {
		expect(() => parse(["--db", ":memory:"])).toThrow(UsageError);
		expect(() => parse(["--db=file::memory:?cache=shared"])).toThrow(UsageError);
	});
});

describe("defaultDbPath", () => {
	test("uses XDG_DATA_HOME when set", () => {
		expect(defaultDbPath({ XDG_DATA_HOME: "/xdg" }, "/home/x")).toBe("/xdg/signal-tui/cache.db");
	});

	test("falls back to ~/.local/share", () => {
		expect(defaultDbPath({}, "/home/x")).toBe("/home/x/.local/share/signal-tui/cache.db");
	});
});
