import { describe, expect, test } from "bun:test";
import {
	JsonRpcClient,
	RpcClosedError,
	RpcError,
	RpcTimeoutError,
} from "../src/adapters/signal/json-rpc-client";
import type { RpcStream } from "../src/adapters/signal/rpc-stream";

class FakeStream implements RpcStream {
	readonly written: string[] = [];
	closed = false;

	#dataHandlers = new Set<(chunk: string) => void>();
	#closeHandlers = new Set<(reason?: string) => void>();

	write(line: string): void {
		if (this.closed) {
			throw new Error("write after close");
		}
		this.written.push(line);
	}

	onData(handler: (chunk: string) => void): () => void {
		this.#dataHandlers.add(handler);
		return () => {
			this.#dataHandlers.delete(handler);
		};
	}

	onClose(handler: (reason?: string) => void): () => void {
		this.#closeHandlers.add(handler);
		return () => {
			this.#closeHandlers.delete(handler);
		};
	}

	close(reason?: string): void {
		if (this.closed) {
			return;
		}
		this.closed = true;
		for (const handler of this.#closeHandlers) {
			handler(reason);
		}
	}

	/** Simulate the peer sending raw text (may be a partial line). */
	push(chunk: string): void {
		for (const handler of this.#dataHandlers) {
			handler(chunk);
		}
	}

	sent(): Array<Record<string, unknown>> {
		return this.written.map((line) => JSON.parse(line) as Record<string, unknown>);
	}
}

describe("JsonRpcClient", () => {
	test("writes a JSON-RPC 2.0 envelope with incrementing ids", async () => {
		const stream = new FakeStream();
		const client = new JsonRpcClient(stream);

		void client.request("version");
		void client.request("listAccounts");

		const sent = stream.sent();
		expect(sent[0]).toMatchObject({ jsonrpc: "2.0", id: 1, method: "version" });
		expect(sent[1]).toMatchObject({ jsonrpc: "2.0", id: 2, method: "listAccounts" });
		expect(sent[0]?.params).toBeUndefined();
	});

	test("includes params when provided", async () => {
		const stream = new FakeStream();
		const client = new JsonRpcClient(stream);
		void client.request("send", { recipient: ["+10000000000"], message: "hi" });
		expect(stream.sent()[0]?.params).toEqual({ recipient: ["+10000000000"], message: "hi" });
	});

	test("resolves the matching response", async () => {
		const stream = new FakeStream();
		const client = new JsonRpcClient(stream);

		const promise = client.request<{ version: string }>("version");
		stream.push(`${JSON.stringify({ jsonrpc: "2.0", id: 1, result: { version: "0.14.9" } })}\n`);

		await expect(promise).resolves.toEqual({ version: "0.14.9" });
		expect(client.pendingCount).toBe(0);
	});

	test("correlates out-of-order responses", async () => {
		const stream = new FakeStream();
		const client = new JsonRpcClient(stream);

		const first = client.request<number>("a");
		const second = client.request<number>("b");
		stream.push(`${JSON.stringify({ id: 2, result: 222 })}\n`);
		stream.push(`${JSON.stringify({ id: 1, result: 111 })}\n`);

		await expect(first).resolves.toBe(111);
		await expect(second).resolves.toBe(222);
	});

	test("handles a line split across chunks", async () => {
		const stream = new FakeStream();
		const client = new JsonRpcClient(stream);

		const promise = client.request<string>("version");
		stream.push('{"jsonrpc":"2.0","id":1,"res');
		stream.push('ult":"0.14.9"}\n');

		await expect(promise).resolves.toBe("0.14.9");
	});

	test("rejects with RpcError on an error response", async () => {
		const stream = new FakeStream();
		const client = new JsonRpcClient(stream);

		const promise = client.request("send");
		stream.push(
			`${JSON.stringify({ id: 1, error: { code: -32602, message: "not registered", data: { account: null } } })}\n`,
		);

		const error = await promise.catch((err: unknown) => err);
		expect(error).toBeInstanceOf(RpcError);
		expect((error as RpcError).code).toBe(-32602);
		expect((error as RpcError).message).toBe("not registered");
	});

	test("times out and forgets the request", async () => {
		const stream = new FakeStream();
		const client = new JsonRpcClient(stream, { defaultTimeoutMs: 10 });

		const promise = client.request("slow");
		const error = await promise.catch((err: unknown) => err);

		expect(error).toBeInstanceOf(RpcTimeoutError);
		expect(client.pendingCount).toBe(0);
	});

	test("ignores a late response after a timeout", async () => {
		const stream = new FakeStream();
		const client = new JsonRpcClient(stream, { defaultTimeoutMs: 10 });

		await client.request("slow").catch(() => undefined);
		stream.push(`${JSON.stringify({ id: 1, result: { ok: true } })}\n`);

		expect(client.pendingCount).toBe(0);
	});

	test("dispatches notifications", () => {
		const stream = new FakeStream();
		const client = new JsonRpcClient(stream);

		const seen: Array<[string, unknown]> = [];
		client.onNotification((method, params) => seen.push([method, params]));
		stream.push(
			`${JSON.stringify({ jsonrpc: "2.0", method: "callEvent", params: { state: "RINGING" } })}\n`,
		);

		expect(seen).toEqual([["callEvent", { state: "RINGING" }]]);
	});

	test("reports malformed lines instead of throwing", () => {
		const stream = new FakeStream();
		const reported: string[] = [];
		const client = new JsonRpcClient(stream, {
			onProtocolError: (_error, line) => reported.push(line),
		});

		stream.push("definitely not json\n");

		expect(reported).toEqual(["definitely not json"]);
		expect(client.pendingCount).toBe(0);
	});

	test("rejects everything pending when the stream closes", async () => {
		const stream = new FakeStream();
		const client = new JsonRpcClient(stream);

		const promise = client.request("version");
		stream.close("child exited");

		const error = await promise.catch((err: unknown) => err);
		expect(error).toBeInstanceOf(RpcClosedError);
		expect((error as RpcClosedError).message).toContain("child exited");
	});

	test("survives a bare null line and keeps serving requests", async () => {
		const stream = new FakeStream();
		const reported: string[] = [];
		const client = new JsonRpcClient(stream, {
			onProtocolError: (_error, line) => reported.push(line),
		});

		stream.push("null\n");

		const promise = client.request<string>("version");
		stream.push(`${JSON.stringify({ id: 1, result: "0.14.9" })}\n`);

		await expect(promise).resolves.toBe("0.14.9");
		expect(reported).toEqual(["null"]);
	});

	test("reports a throwing notification handler and keeps reading", () => {
		const stream = new FakeStream();
		let errors = 0;
		const client = new JsonRpcClient(stream, { onProtocolError: () => errors++ });
		client.onNotification(() => {
			throw new Error("handler boom");
		});

		stream.push(`${JSON.stringify({ method: "callEvent", params: {} })}\n`);
		stream.push(`${JSON.stringify({ method: "callEvent", params: {} })}\n`);

		expect(errors).toBe(2);
	});

	test("drops an oversized unterminated line instead of buffering forever", async () => {
		const stream = new FakeStream();
		const errors: string[] = [];
		const client = new JsonRpcClient(stream, {
			maxLineBytes: 32,
			onProtocolError: (error) => errors.push(error.message),
		});

		stream.push("x".repeat(64));
		expect(errors).toHaveLength(1);
		expect(errors[0]).toContain("exceeded");

		const promise = client.request<string>("version");
		stream.push(`${JSON.stringify({ id: 1, result: "0.14.9" })}\n`);

		await expect(promise).resolves.toBe("0.14.9");
	});

	test("counts the line limit in UTF-8 bytes, not code units", () => {
		const stream = new FakeStream();
		const errors: string[] = [];
		const client = new JsonRpcClient(stream, {
			maxLineBytes: 32,
			onProtocolError: (error) => errors.push(error.message),
		});

		// 20 code units, 40 UTF-8 bytes: over the limit only if measured in bytes.
		stream.push("ż".repeat(20));

		expect(errors).toHaveLength(1);
		expect(errors[0]).toContain("exceeded");
	});

	test("skips an oversized complete line before parsing it", async () => {
		const stream = new FakeStream();
		const errors: string[] = [];
		const client = new JsonRpcClient(stream, {
			maxLineBytes: 32,
			onProtocolError: (error) => errors.push(error.message),
		});

		stream.push(`${"ż".repeat(20)}\n`);

		const promise = client.request<string>("version");
		stream.push(`${JSON.stringify({ id: 1, result: "0.14.9" })}\n`);

		await expect(promise).resolves.toBe("0.14.9");
		expect(errors).toHaveLength(1);
		expect(errors[0]).toContain("line ignored");
	});

	test("refuses new requests after close", async () => {
		const stream = new FakeStream();
		const client = new JsonRpcClient(stream);
		client.close();

		const error = await client.request("version").catch((err: unknown) => err);
		expect(error).toBeInstanceOf(RpcClosedError);
	});
});
