import type { Contact } from "../../domain/types";
import type { ContactPayload } from "./schemas";

/**
 * A contact row, as the picker needs it.
 *
 * Two jobs, both about not showing a blank: the id has to be addressable (Signal takes a number
 * or a uuid, and a contact may have only one of them), and the label has to be something a person
 * recognises. The engine degrades in a defined order — the contact's own name, then the nickname
 * they set, then the profile's first and last name — and only a contact with no name at all falls
 * back to their number, which is still better than an empty row.
 *
 * Unregistered contacts are dropped rather than offered: the engine knows the number is dead, so
 * a picker row for them would only be a chat that cannot receive anything. `unregistered` is
 * `nullish` because an older engine does not emit it at all, and unknown is not the same as dead.
 */
export function mapContact(payload: ContactPayload): Contact | null {
	const number = clean(payload.number);
	const uuid = clean(payload.uuid);
	const id = number ?? uuid;
	if (id === null) {
		return null;
	}
	if (payload.unregistered === true) {
		return null;
	}
	const name = label(payload, id);
	return {
		id,
		name,
		...(number === null ? {} : { number }),
		...(uuid === null ? {} : { uuid }),
	};
}

export function mapContacts(payloads: readonly ContactPayload[]): readonly Contact[] {
	return payloads.map(mapContact).filter((contact): contact is Contact => contact !== null);
}

/** Blankness is `""` as often as it is `null`: a contact with only a first name has both. */
function clean(value: string | null | undefined): string | null {
	const trimmed = (value ?? "").trim();
	return trimmed.length === 0 ? null : trimmed;
}

function label(payload: ContactPayload, fallback: string): string {
	const joined = [payload.profile?.givenName, payload.profile?.familyName]
		.map((part) => clean(part))
		.filter((part): part is string => part !== null)
		.join(" ");
	const direct = [payload.name, payload.nickName, payload.givenName, joined]
		.map((part) => clean(part))
		.find((part) => part !== null);
	return direct ?? fallback;
}
