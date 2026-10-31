import { describe, expect, test } from "bun:test";
import { mapContacts } from "../src/adapters/signal/map-contacts";
import { setup } from "./helpers/fake-rpc";

/**
 * Contacts, both halves: what the engine's payload means, and what asking for it puts on the wire.
 *
 * The field names come from `JsonContact` at signal-cli master — `name`, `nickName`, `givenName`,
 * `familyName`, `profile{ givenName, familyName }`, `unregistered` — so a fixture that "looks
 * right" is not enough: it has to carry the keys the engine actually emits.
 */
describe("mapping a contact", () => {
	test("prefers the contact's own name over the profile's", () => {
		const [contact] = mapContacts([
			{
				number: "+48600222333",
				uuid: "uuid-marta",
				name: "Marta (work)",
				nickName: "Martusia",
				profile: { givenName: "Marta", familyName: "Kowalska" },
			},
		]);
		expect(contact).toEqual({
			id: "uuid-marta",
			name: "Marta (work)",
			number: "+48600222333",
			uuid: "uuid-marta",
		});
	});

	test("falls back to the nickname, then the profile, then the number", () => {
		const [nickname] = mapContacts([{ number: "+1", nickName: "Martusia" }]);
		expect(nickname?.name).toBe("Martusia");
		const [profile] = mapContacts([
			{ number: "+2", profile: { givenName: "Marta", familyName: "Kowalska" } },
		]);
		expect(profile?.name).toBe("Marta Kowalska");
		const [bare] = mapContacts([{ number: "+48600222333" }]);
		expect(bare?.name).toBe("+48600222333");
	});

	test("addresses a contact with no number by their uuid", () => {
		const [contact] = mapContacts([{ uuid: "uuid-zosia", name: "Zosia" }]);
		expect(contact).toEqual({ id: "uuid-zosia", name: "Zosia", uuid: "uuid-zosia" });
	});

	test("drops a row there is nothing to address", () => {
		// No number, no uuid: a name and no way to send to it. Offering it would be a picker row
		// whose `⏎` cannot open anything.
		expect(mapContacts([{ name: "Ghost" }])).toEqual([]);
	});

	test("drops a contact the engine knows is no longer registered", () => {
		// `unregistered` is what the engine says when the number has left Signal: the row would be
		// a chat that cannot receive. Absent (older engine) is not the same as true.
		expect(mapContacts([{ number: "+48600222333", name: "Marta", unregistered: true }])).toEqual(
			[],
		);
		expect(
			mapContacts([{ number: "+48600222333", name: "Marta", unregistered: null }]),
		).toHaveLength(1);
	});
});

describe("asking the engine for contacts", () => {
	test("calls listContacts and maps what comes back", async () => {
		const { rpc, backend } = setup();
		rpc.results.set("listContacts", [
			{ number: "+48600222333", uuid: "uuid-marta", name: "Marta" },
			{ number: "+48600111222", uuid: "uuid-adam", name: "Adam" },
		]);

		const contacts = await backend.listContacts();

		expect(rpc.requests.at(-1)).toEqual({ method: "listContacts" });
		expect(contacts.map((contact) => contact.name)).toEqual(["Marta", "Adam"]);
	});

	test("a payload this build does not understand is an empty list, not a thrown key", async () => {
		const { rpc, backend } = setup();
		rpc.results.set("listContacts", "not a list");

		expect(await backend.listContacts()).toEqual([]);
		// Recorded rather than swallowed: `doctor`-style debugging needs to know the read failed.
		expect(backend.protocolErrors.at(-1)).toContain("listContacts");
	});

	test("an engine that answers nothing is an empty list", async () => {
		const { backend } = setup();
		expect(await backend.listContacts()).toEqual([]);
	});
});
