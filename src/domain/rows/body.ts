import { describeBody } from "../format";
import type { Message } from "../types";
import { type DisplayBody, textForDisplay } from "./text";

/** A message's body, cut to `maxRows` wrapped rows. */
export function bodyForDisplay(message: Message, maxRows: number, innerWidth: number): DisplayBody {
	return textForDisplay(describeBody(message), maxRows, innerWidth);
}
