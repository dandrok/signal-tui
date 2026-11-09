import { describe, expect, test } from "bun:test";
import type { PromptState } from "../src/app/state";
import type { NewChatMatches } from "../src/app/usecases/new-chat";
import type { Contact } from "../src/domain/types";
import { choiceLine } from "../src/ui/prompt-choice";

/**
 * The one line the `new` picker draws under the prompt.
 *
 * A contact's name and number are remote text — the profile name is whatever the other side set —
 * and this row is rendered straight into `<Text>`, so the sanitiser has to run here and not only
 * in the branches beside it.
 */

const CONTACT: Contact = {
	id: "uuid-marta",
	name: "Marta",
	number: "+481****2333",
	uuid: "uuid-marta",
};

const prompt = (contacts: readonly Contact[]): PromptState => ({
	kind: "new",
	targetId: null,
	draft: "",
	pick: 0,
	contacts,
});

const matches = (name: string): NewChatMatches => ({
	rows: [{ kind: "contact", id: "uuid-marta", name, detail: "+481****2333" }],
	picked: 0,
});

describe("the new-chat choice line", () => {
	test("names the picked contact and its position", () => {
		const choice = choiceLine(prompt([CONTACT]), matches("Marta"));

		expect(choice.picked).toBe(true);
		expect(choice.destination).toContain("Marta");
		expect(choice.destination).toContain("1/1");
	});

	test("strips an escape sequence out of a name a peer controls", () => {
		// SGR in the name: ink passes colour through, so an unsanitised name recolours the row
		// (or hides its own text) instead of showing up as the word someone chose.
		const hostile = "\u001b[31mMarta\u001b[0m";
		const choice = choiceLine(prompt([CONTACT]), matches(hostile));

		expect(choice.destination).not.toContain("\u001b");
		expect(choice.destination).toContain("Marta");
	});
});
