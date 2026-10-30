import type { Clock } from "../../src/domain/format";

/**
 * A stub clock for layout assertions: no ICU formatting, no timezone, no host day.
 *
 * Days are counted from the epoch, so a fixture can say "the same day" or "the next day" by
 * adding 86 400 000 ms without a calendar in the way, and every message in one test shares a day
 * unless it asks for another.
 */
export function stubClock(time = "10:00"): Clock {
	return {
		time: () => time,
		dayKey: (timestampMs: number): string => String(Math.floor(timestampMs / 86_400_000)),
		dayLabel: (): string => "Fri 30 Oct",
	};
}
