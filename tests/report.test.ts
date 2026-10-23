import { describe, expect, test } from "bun:test";
import { formatStartupFailure } from "../src/app/report";

describe("formatStartupFailure", () => {
	test("names the account and the failing reason", () => {
		const message = formatStartupFailure("+48123456789", new Error("subscribeReceive failed"));

		expect(message).toContain("+48123456789");
		expect(message).toContain("subscribeReceive failed");
		expect(message).toContain("bun run doctor");
	});

	test("adds an install hint when the binary is missing", () => {
		const message = formatStartupFailure(
			"+48123456789",
			new Error('Executable not found in $PATH: "signal-cli"'),
		);
		expect(message).toContain("install 0.14 or newer");
	});

	test("keeps only the first line of a long error", () => {
		const message = formatStartupFailure(
			"+48123456789",
			new Error("boom\n  at somewhere.ts:1:1\n  at other"),
		);
		expect(message).not.toContain("somewhere.ts");
		expect(message.split("\n")[0]).toContain("boom");
	});

	test("handles a non-Error rejection", () => {
		expect(formatStartupFailure("+48123456789", "nope")).toContain("nope");
	});
});
