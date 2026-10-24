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
	return (timestampMs: number): string => cached.format(timestampMs);
}

/** The zone the terminal user lives in; resolved once per app start. */
export function localTimeZone(): string {
	return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
