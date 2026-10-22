import { describe, expect, test } from "bun:test";
import { JsonRpcClient } from "../src/adapters/signal/json-rpc-client";
import { FakeStream } from "./helpers/fake-stream";

const MAX = 32;

describe("JsonRpcClient line limits", () => {
	test("drops an oversized unterminated line and resumes after the next newline", async () => {
		const stream = new FakeStream();
		const errors: string[] = [];
		const client = new JsonRpcClient(stream, {
			maxLineBytes: MAX,
			onProtocolError: (error) => errors.push(error.message),
		});

		stream.push("x".repeat(64));
		expect(errors).toHaveLength(1);
		expect(errors[0]).toContain("exceeded");

		// Still inside the dropped line: must be swallowed, not parsed.
		stream.push("y".repeat(20));
		// The newline that ends the oversized line allows normal parsing again.
		stream.push("\n");

		const promise = client.request<string>("version");
		stream.push(`${JSON.stringify({ id: 1, result: "0.14.9" })}\n`);

		await expect(promise).resolves.toBe("0.14.9");
		expect(errors).toHaveLength(1);
		expect(client.pendingCount).toBe(0);
	});

	test("counts the limit in UTF-8 bytes, not code units", () => {
		const stream = new FakeStream();
		const errors: string[] = [];
		new JsonRpcClient(stream, {
			maxLineBytes: MAX,
			onProtocolError: (error) => errors.push(error.message),
		});

		// 20 code units, 40 UTF-8 bytes: over the limit only when measured in bytes.
		stream.push("ż".repeat(20));

		expect(errors).toHaveLength(1);
		expect(errors[0]).toContain("exceeded");
	});

	test("skips an oversized complete line before parsing it", async () => {
		const stream = new FakeStream();
		const errors: string[] = [];
		const client = new JsonRpcClient(stream, {
			maxLineBytes: MAX,
			onProtocolError: (error) => errors.push(error.message),
		});

		stream.push(`${"ż".repeat(20)}\n`);

		const promise = client.request<string>("version");
		stream.push(`${JSON.stringify({ id: 1, result: "0.14.9" })}\n`);

		await expect(promise).resolves.toBe("0.14.9");
		expect(errors).toHaveLength(1);
		expect(errors[0]).toContain("line ignored");
	});

	test("rejects an oversized line even when trimming would fit the limit", () => {
		const stream = new FakeStream();
		const errors: string[] = [];
		new JsonRpcClient(stream, {
			maxLineBytes: MAX,
			onProtocolError: (error) => errors.push(error.message),
		});

		// 8 bytes of JSON plus 40 bytes of padding: over the cap raw, under it trimmed.
		stream.push(`${JSON.stringify({ id: 9 }) + " ".repeat(40)}\n`);

		expect(errors).toHaveLength(1);
		expect(errors[0]).toContain("line ignored");
	});
});
