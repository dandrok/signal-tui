import { describe, expect, test } from "bun:test";
import { clockFor } from "../src/ui/clock";

describe("clockFor", () => {
	test("renders a two-digit 24h clock in the requested zone", () => {
		expect(clockFor("UTC")(Date.UTC(2026, 9, 22, 9, 5))).toBe("09:05");
	});

	test("zero-pads both halves", () => {
		expect(clockFor("UTC")(Date.UTC(2026, 9, 22, 0, 0))).toBe("00:00");
	});

	test("shifts with the zone instead of the host clock", () => {
		// 07:04 UTC is 09:04 in Warsaw and 03:04 in New York; a formatter reading the
		// host timezone could only ever produce one of the three.
		const instant = Date.UTC(2026, 9, 24, 7, 4);
		expect(clockFor("Europe/Warsaw")(instant)).toBe("09:04");
		expect(clockFor("America/New_York")(instant)).toBe("03:04");
	});

	test("reuses one formatter per zone", () => {
		// Constructing an Intl.DateTimeFormat costs ~52 µs against ~1 µs to format,
		// so a per-call construction would put ~100 ms into this loop.
		const clock = clockFor("UTC");
		const started = Bun.nanoseconds();
		for (let index = 0; index < 2000; index += 1) {
			clock(index);
		}
		expect((Bun.nanoseconds() - started) / 1e6).toBeLessThan(50);
	});
});
