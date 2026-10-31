import type { Contact } from "../../domain/types";
import type { ContactPayload } from "./schemas";

/**
 * A contact row, as the picker needs it.
 *
 * Two jobs, both about not showing a blank: the id has to be the key a direct conversation is
 * stored under, and the label has to be something a person recognises. The engine degrades in a
 * defined order — the contact's own name, then the nickname they set, then the profile's first and
 * last name — and only a contact with no name at all falls back to their number, which is still
 * better than an empty row.
 *
 * The id is the uuid when there is one, exactly as `peerId` keys an incoming envelope: a
 * conversation lives under the uuid, so a contact addressed by their number would open a second,
 * empty thread beside the one their messages already arrive in — and the uuid is also what
 * survives a number change. A number is the fallback, for a contact the engine knows only that
 * way.
 *
 * Unregistered contacts are dropped rather than offered: the engine knows the number is dead, so
 * a picker row for them would only be a chat that cannot receive anything. `unregistered` is
 * `nullish` because an older engine does not emit it at all, and unknown is not the same as dead.
 */
export function mapContact(payload: ContactPayload): Contact | null {
	const number = clean(payload.number);
	const uuid = clean(payload.uuid);
	const id = uuid ?? number;
	if (id === null) {
		return null;
	}
	if (payload.unregistered === true) {
		return null;
	}
	// The label falls back to the number, never to the uuid: a uuid is an address, not something
	// a person reads.
	const name = label(payload, number ?? id);
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
