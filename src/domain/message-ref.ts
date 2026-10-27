/**
 * The identity of a message on the wire: when it was sent, and who wrote it.
 *
 * Signal names an earlier message this way for a reaction, an edit and a delete-for-everyone
 * alike — a timestamp alone would be ambiguous across threads, and the engine refuses a
 * reaction without its author. One shape, three commands.
 */
export interface MessageRef {
	readonly sentAt: number;
	/** The author's uuid or number; `SELF_AUTHOR_ID` is turned into the account number. */
	readonly authorId: string;
}
