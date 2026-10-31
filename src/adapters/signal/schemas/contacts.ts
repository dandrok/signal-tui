import { z } from "zod";

/**
 * One contact, as `listContacts` emits it.
 *
 * Checked against `JsonContact` at signal-cli master (2026-10-30):
 * `(number, uuid, username, name, givenName, familyName, nickName, nickNameGivenName,
 * nickNameFamilyName, note, color, isArchived, isBlocked, isHidden, messageExpirationTime,
 * profileSharingEnabled, unregistered, profile, internal)`. The JSON-RPC path always writes the
 * detailed form, so `profile` is there even though the CLI only fills it with `--detailed`.
 *
 * `.loose()` and `.nullish()` for the same reason the envelope schemas use them: a newer engine
 * adds fields, and a contact whose number is hidden emits `null`, not a missing key.
 */
export const contactSchema = z
	.object({
		number: z.string().nullish(),
		uuid: z.string().nullish(),
		username: z.string().nullish(),
		name: z.string().nullish(),
		givenName: z.string().nullish(),
		familyName: z.string().nullish(),
		nickName: z.string().nullish(),
		/** Set when the engine knows the number is no longer registered. */
		unregistered: z.boolean().nullish(),
		profile: z
			.object({
				givenName: z.string().nullish(),
				familyName: z.string().nullish(),
				about: z.string().nullish(),
			})
			.loose()
			.nullish(),
	})
	.loose();

export const contactsSchema = z.array(contactSchema);

export type ContactPayload = z.infer<typeof contactSchema>;
