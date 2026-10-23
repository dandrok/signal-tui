import { describe, expect, test } from "bun:test";
import { visibleWindow } from "../src/ui/SearchPane";

describe("visibleWindow", () => {
	test("shows everything when it fits", () => {
		expect(visibleWindow(3, 0, 10)).toEqual({ start: 0, count: 3 });
		expect(visibleWindow(0, 0, 10)).toEqual({ start: 0, count: 0 });
	});

	test("starts at the top while the selection is on the first screen", () => {
		expect(visibleWindow(20, 0, 5)).toEqual({ start: 0, count: 5 });
		expect(visibleWindow(20, 4, 5)).toEqual({ start: 0, count: 5 });
	});

	test("follows the selection past the first screen", () => {
		// A selection outside the window would hide the highlight, and Enter would
		// open a result nobody can see.
		expect(visibleWindow(20, 5, 5)).toEqual({ start: 1, count: 5 });
		expect(visibleWindow(20, 12, 5)).toEqual({ start: 8, count: 5 });
	});

	test("never scrolls past the end", () => {
		expect(visibleWindow(20, 19, 5)).toEqual({ start: 15, count: 5 });
	});

	test("survives a silly capacity", () => {
		expect(visibleWindow(20, 0, 0)).toEqual({ start: 0, count: 1 });
	});
});
