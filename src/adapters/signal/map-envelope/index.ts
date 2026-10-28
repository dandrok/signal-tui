/**
 * Envelope → domain, in one dispatch and six small rules.
 *
 * `mapEnvelope` decides *which* rule applies and nothing else: an edit, a receipt, a data
 * message, a typing notice, a sync transcript, or nothing at all. Each rule lives beside its
 * own explanation — `incoming.ts` for a peer's message, `sent.ts` for our own echoed back,
 * `edit.ts` for a correction, `content.ts` for what counts as content and for the timer that
 * is not content.
 *
 * No IO and no clock reads: the same envelope always produces the same result, which is what
 * makes the adapter testable from fixtures.
 */
import { mapReceipt } from "../map-receipt";
import { mapTyping } from "../map-typing";
import type { Envelope } from "../schemas";
import { mapEdit } from "./edit";
import { mapIncoming } from "./incoming";
import { mapSent } from "./sent";
import { EMPTY, type MappedEnvelope } from "./types";

export {
	type DeletedMessage,
	type EditedMessage,
	EMPTY,
	type MappedEnvelope,
	SELF_ACTOR,
} from "./types";

export function mapEnvelope(envelope: Envelope): MappedEnvelope {
	if (envelope.editMessage !== undefined) {
		return mapEdit(envelope, envelope.editMessage);
	}

	if (envelope.receiptMessage !== undefined) {
		// A receipt acknowledges messages we already sent; it never inserts one.
		const receipt = mapReceipt(envelope.receiptMessage);
		return receipt === null ? EMPTY : { ...EMPTY, receipt };
	}

	if (envelope.dataMessage !== undefined) {
		return mapIncoming(envelope, envelope.dataMessage);
	}

	if (envelope.typingMessage !== undefined) {
		// Not a message: nothing is stored, and the session holds it as state that expires.
		const typed = mapTyping(envelope, envelope.typingMessage);
		return typed === null
			? EMPTY
			: { ...EMPTY, typing: typed, conversationKind: typed.conversationKind };
	}

	const sent = envelope.syncMessage?.sentMessage;
	if (sent !== undefined) {
		return mapSent(sent);
	}

	return EMPTY;
}
