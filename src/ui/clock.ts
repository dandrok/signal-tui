import type { Clock } from "../domain/format";

/**
 * Clock formatter for a zone, cached per zone. Constructing an
 * `Intl.DateTimeFormat` costs ~50 µs against ~1 µs to format, and this runs for
 * every visible message on every frame, so the cache lives in the UI layer: the
 * domain gets an injected `Clock` and stays free of mutable state.
 */
interface ZoneFormatters {
	readonly time: Intl.DateTimeFormat;
	readonly dayKey: Intl.DateTimeFormat;
	readonly dayLabel: Intl.DateTimeFormat;
}

const formatters = new Map<string, ZoneFormatters>();

function formattersFor(timeZone: string): ZoneFormatters {
	let cached = formatters.get(timeZone);
	if (cached === undefined) {
		cached = {
			time: new Intl.DateTimeFormat("en-GB", {
				timeZone,
				hour: "2-digit",
				minute: "2-digit",
				hourCycle: "h23",
			}),
			// `en-CA` is the locale whose short numeric date is `2026-10-30`: sortable, and free of
			// the month names two zones might disagree about.
			dayKey: new Intl.DateTimeFormat("en-CA", {
				timeZone,
				year: "numeric",
				month: "2-digit",
				day: "2-digit",
			}),
			dayLabel: new Intl.DateTimeFormat("en-GB", {
				timeZone,
				weekday: "short",
				day: "numeric",
				month: "short",
			}),
		};
		formatters.set(timeZone, cached);
	}
	return cached;
}

export function clockFor(timeZone: string): Clock {
	const cached = formattersFor(timeZone);
	return {
		time: (timestampMs: number): string => {
			const text = cached.time.format(timestampMs);
			// Some ICU builds render midnight as 24:00 even with hourCycle "h23". A chat
			// timestamp has no 24th hour, and the difference is invisible on the machines
			// that get it right — so normalise rather than depend on the ICU version.
			return text.startsWith("24:") ? `00:${text.slice(3)}` : text;
		},
		dayKey: (timestampMs: number): string => cached.dayKey.format(timestampMs),
		dayLabel: (timestampMs: number): string => cached.dayLabel.format(timestampMs),
	};
}

/** The zone the terminal user lives in; resolved once per app start. */
export function localTimeZone(): string {
	return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
