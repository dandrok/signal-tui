import { describe, expect, test } from "bun:test";
import { createProcessStream } from "../src/adapters/signal/process-stream";

const waitForClose = (
	stream: ReturnType<typeof createProcessStream>,
): Promise<string | undefined> =>
	new Promise((resolve) => {
		stream.onClose((reason) => resolve(reason));
	});

describe("createProcessStream", () => {
	test("a throwing close handler does not stop the others", async () => {
		const stream = createProcessStream({ command: ["sh", "-c", "exit 3"] });
		let attempted = 0;

		const closed = new Promise<string | undefined>((resolve) => {
			stream.onClose(() => {
				attempted++;
				throw new Error("close handler boom");
			});
			stream.onClose((reason) => {
				attempted++;
				resolve(reason);
			});
		});

		const reason = await closed;
		expect(attempted).toBe(2);
		expect(reason).toContain("3");
	});

	test("keeps the stderr tail on a UTF-8 boundary", async () => {
		const stream = createProcessStream({
			command: ["sh", "-c", 'printf "żżż" >&2; exit 1'],
			stderrLimitBytes: 5,
		});

		const reason = await waitForClose(stream);
		expect(reason ?? "").not.toContain("\uFFFD");
		// 6 bytes of "żżż", window of 5 bytes starts mid-character: the leading
		// continuation byte is skipped, leaving exactly two characters.
		expect(reason).toBe("żż");
	});

	test("delivers stdout lines to data handlers", async () => {
		const stream = createProcessStream({ command: ["sh", "-c", 'printf "%s\\n" hello'] });
		const chunks: string[] = [];
		stream.onData((chunk) => chunks.push(chunk));

		await waitForClose(stream);
		expect(chunks.join("")).toBe("hello\n");
	});
});
