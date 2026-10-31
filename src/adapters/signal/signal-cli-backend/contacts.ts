import type { Contact } from "../../../domain/types";
import { mapContacts } from "../map-contacts";
import { contactsSchema } from "../schemas";
import type { ProtocolErrorLog } from "./error-log";
import type { RpcCaller } from "./types";

/**
 * The account's contacts, as one function rather than a method on the backend class.
 *
 * `listContacts` is the one call that answers a question instead of changing something, and the
 * class is deliberately a list of operations; this is also the only place that has to decide what
 * a *bad* answer means. It means "empty list plus a recorded protocol error": the picker is a
 * convenience, and a refused key with no explanation is worse than a picker that says it knows
 * nobody. The engine still knows them, so the next `n` asks again.
 */
export async function readContacts(
	client: RpcCaller,
	errors: ProtocolErrorLog,
): Promise<readonly Contact[]> {
	const raw = await client.request<unknown>("listContacts");
	const parsed = contactsSchema.safeParse(raw ?? []);
	if (!parsed.success) {
		errors.record(`listContacts: ${parsed.error.message}`);
		return [];
	}
	return mapContacts(parsed.data);
}
