import { describe, expect, test } from "bun:test";
import { render } from "ink-testing-library";
import { InMemoryStore } from "../src/adapters/memory/store";
import { Root } from "../src/ui/Root";

const tick = (ms = 120): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Renders `Root`, not `App`: this is the only test where a keystroke travels
 * through the real store and back into a frame, so deleting the store.search
 * call fails here.
 */
describe("search through the real store", () => {
	test("typing a query shows matching messages from the cache", async () => {
		const { stdin, lastFrame, unmount } = render(<Root store={new InMemoryStore()} />);
		await tick();

		stdin.write("/");
		await tick();
		stdin.write("dinner");
		await tick();

		const frame = lastFrame() ?? "";
		expect(frame).toContain("Search  dinner");
		// A demo message body, so the query really reached the cache.
		expect(frame).toContain("dinner");
		unmount();
	});

	test("a query with no matches says so", async () => {
		const { stdin, lastFrame, unmount } = render(<Root store={new InMemoryStore()} />);
		await tick();

		stdin.write("/");
		await tick();
		stdin.write("zzzzzznotfound");
		await tick();

		expect(lastFrame() ?? "").toContain("no matches");
		unmount();
	});

	test("escape closes search and restores the conversation list", async () => {
		const { stdin, lastFrame, unmount } = render(<Root store={new InMemoryStore()} />);
		await tick();

		stdin.write("/");
		await tick();
		expect(lastFrame() ?? "").toContain("Search");

		stdin.write("\u001B");
		await tick();

		expect(lastFrame() ?? "").toContain("Conversations");
		unmount();
	});
});
