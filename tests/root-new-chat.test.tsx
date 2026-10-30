import { describe, expect, test } from "bun:test";
import { render } from "ink-testing-library";
import { InMemoryStore } from "../src/adapters/memory/store";
import type { Session } from "../src/app/session";
import type { Contact } from "../src/domain/types";
import { Root } from "../src/ui/Root";
import { plain } from "./helpers/frame";

const tick = (ms = 120): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const CONTACTS: readonly Contact[] = [
	{ id: "+48600111222", name: "Adam", number: "+48600111222", uuid: "uuid-adam" },
	{ id: "+48600222333", name: "Marta", number: "+48600222333", uuid: "uuid-marta" },
];

/**
 * The surface `n` actually touches: the contact read, and the local write. Both are recorded
 * rather than performed, because what this test is about is which id the picker chose.
 */
function fakeSession(contacts: readonly Contact[] = CONTACTS) {
	const started: Array<{ id: string; name: string }> = [];
	let listener: (() => void) | null = null;
	const session: Session = {
		start: async () => undefined,
		stop: async () => undefined,
		send: async () => undefined,
		markRead: async () => undefined,
		startDirect: async (id, name) => {
			started.push({ id, name });
		},
		listContacts: async () => contacts,
		typingIn: () => null,
		react: async () => undefined,
		edit: async () => undefined,
		remove: async () => undefined,
		hide: async () => undefined,
		flush: async () => undefined,
		onChange: (next) => {
			listener = next;
			return () => {
				listener = null;
			};
		},
		onIncoming: () => () => undefined,
		errors: [],
	};
	const notify = (): void => listener?.();
	return { session, started, notify };
}

async function frameWith(lastFrame: () => string | undefined, text: string): Promise<string> {
	for (let attempt = 0; attempt < 40; attempt++) {
		const frame = plain(lastFrame() ?? "");
		if (frame.includes(text)) {
			return frame;
		}
		await tick(25);
	}
	return plain(lastFrame() ?? "");
}

describe("starting a conversation from the list", () => {
	test("n offers the contacts, and ⏎ opens the picked one", async () => {
		const { session, started } = fakeSession();
		const { stdin, lastFrame, unmount } = render(
			<Root store={new InMemoryStore()} session={session} />,
		);
		await tick();

		stdin.write("n");
		await frameWith(lastFrame, "new ›");

		// The list is a read: the picker says so before it has one, then names what it found.
		const opened = await frameWith(lastFrame, "Marta");
		expect(opened).toContain("Marta");
		expect(opened).toContain("1/2");

		stdin.write("mar");
		const filtered = await frameWith(lastFrame, "1/1");
		expect(filtered).toContain("Marta");

		stdin.write("\r");
		await frameWith(lastFrame, "conversation with Marta");
		expect(started).toEqual([{ id: "+48600222333", name: "Marta" }]);
		unmount();
	});

	test("a number nobody is called opens a thread too", async () => {
		const { session, started } = fakeSession();
		const { stdin, lastFrame, unmount } = render(
			<Root store={new InMemoryStore()} session={session} />,
		);
		await tick();

		stdin.write("n");
		await frameWith(lastFrame, "new ›");
		stdin.write("+48 600 999 888");
		await frameWith(lastFrame, "not a contact yet");
		stdin.write("\r");
		await frameWith(lastFrame, "conversation with +48600999888");

		expect(started).toEqual([{ id: "+48600999888", name: "+48600999888" }]);
		unmount();
	});

	test("escape leaves the list alone", async () => {
		const { session, started } = fakeSession();
		const { stdin, lastFrame, unmount } = render(
			<Root store={new InMemoryStore()} session={session} />,
		);
		await tick();

		stdin.write("n");
		await frameWith(lastFrame, "new ›");
		stdin.write("\u001b");
		const after = await frameWith(lastFrame, "j/k move");
		expect(after).not.toContain("new ›");
		expect(started).toEqual([]);
		unmount();
	});

	test("a filter that matches nobody says so instead of opening something", async () => {
		const { session, started } = fakeSession();
		const { stdin, lastFrame, unmount } = render(
			<Root store={new InMemoryStore()} session={session} />,
		);
		await tick();

		stdin.write("n");
		await frameWith(lastFrame, "new ›");
		stdin.write("zzzz");
		await frameWith(lastFrame, "nothing matches");
		stdin.write("\r");
		const after = await frameWith(lastFrame, "not a phone number");
		expect(after).toContain("not a phone number");
		expect(started).toEqual([]);
		unmount();
	});
});
