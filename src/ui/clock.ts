import type { Clock } from "../domain/format";

/**
 * Clock formatter for a zone, cached per zone. Constructing an
 * `Intl.DateTimeFormat` costs ~50 µs against ~1 µs to format, and this runs for
 * every visible message on every frame, so the cache lives in the UI layer: the
 * domain gets an injected `Clock` and stays free of mutable state.
 */
const formatters = new Map<string, Intl.DateTimeFormat>();

export function clockFor(timeZone: string): Clock {
	let formatter = formatters.get(timeZone);
	if (formatter === undefined) {
		formatter = new Intl.DateTimeFormat("en-GB", {
			timeZone,
			hour: "2-digit",
			minute: "2-digit",
			hourCycle: "h23",
		});
		formatters.set(timeZone, formatter);
	}
	const cached = formatter;
	return (timestampMs: number): string => {
		const text = cached.format(timestampMs);
		// Some ICU builds render midnight as 24:00 even with hourCycle "h23". A chat
		// timestamp has no 24th hour, and the difference is invisible on the machines
		// that get it right — so normalise rather than depend on the ICU version.
		return text.startsWith("24:") ? `00:${text.slice(3)}` : text;
	};
}

/** The zone the terminal user lives in; resolved once per app start. */
export function localTimeZone(): string {
	return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
