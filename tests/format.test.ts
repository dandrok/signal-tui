import { describe, expect, test } from "bun:test";
import {
	describeAuthor,
	describeBody,
	displayName,
	formatUnread,
	truncate,
} from "../src/domain/format";
import type { Message } from "../src/domain/types";
import { normaliseSize } from "../src/ui/hooks/useTerminalSize";

const message = (overrides: Partial<Message> = {}): Message => ({
	id: "m-1",
	conversationId: "c-1",
	author: "Alice",
	body: "hello",
	sentAt: 0,
	isOutgoing: false,
	isDeleted: false,
	...overrides,
});

describe("truncate", () => {
	test("leaves text that fits untouched", () => {
		expect(truncate("hello", 10)).toBe("hello");
	});

	test("cuts with an ellipsis when it overflows", () => {
		expect(truncate("hello world", 8)).toBe("hello w…");
		expect(truncate("hello world", 8)).toHaveLength(8);
	});

	test("degrades at tiny widths", () => {
		expect(truncate("abc", 1)).toBe("…");
		expect(truncate("abc", 0)).toBe("");
		expect(truncate("abc", -5)).toBe("");
	});
});

describe("formatUnread", () => {
	test("is empty when nothing is unread", () => {
		expect(formatUnread(0)).toBe("");
		expect(formatUnread(-3)).toBe("");
	});

	test("caps the badge", () => {
		expect(formatUnread(3)).toBe("3");
		expect(formatUnread(99)).toBe("99");
		expect(formatUnread(120)).toBe("99+");
	});
});

describe("describeAuthor / describeBody", () => {
	test("marks outgoing messages as You", () => {
		expect(describeAuthor(message({ isOutgoing: true }))).toBe("You");
	});

	test("prefers deletion over authorship", () => {
		const deleted = message({ isDeleted: true, isOutgoing: true });
		expect(describeAuthor(deleted)).toBe("deleted");
		expect(describeBody(deleted)).toBe("message deleted");
	});

	test("shows the real author and body otherwise", () => {
		expect(describeAuthor(message())).toBe("Alice");
		expect(describeBody(message())).toBe("hello");
	});
});

describe("displayName", () => {
	test("falls back to the id when no name is known", () => {
		const base = { unreadCount: 0, lastActivityAt: 1 };
		expect(displayName({ ...base, id: "uuid-x", name: "Alice" })).toBe("Alice");
		expect(displayName({ ...base, id: "uuid-x", name: "" })).toBe("uuid-x");
		expect(displayName({ ...base, id: "uuid-x", name: "   " })).toBe("uuid-x");
	});
});

describe("normaliseSize", () => {
	test("falls back when the terminal reports nothing", () => {
		expect(normaliseSize({})).toEqual({ columns: 80, rows: 24 });
	});

	test("clamps to usable minimums", () => {
		expect(normaliseSize({ columns: 10, rows: 5 })).toEqual({ columns: 40, rows: 12 });
	});

	test("floors fractional sizes", () => {
		expect(normaliseSize({ columns: 100.7, rows: 30.2 })).toEqual({ columns: 100, rows: 30 });
	});
});
