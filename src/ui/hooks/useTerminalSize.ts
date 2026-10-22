import { useEffect, useState } from "react";

export interface TerminalSize {
	readonly columns: number;
	readonly rows: number;
}

const FALLBACK: TerminalSize = { columns: 80, rows: 24 };
const MIN_COLUMNS = 40;
const MIN_ROWS = 12;

/**
 * Normalise a size reading, clamping to something usable.
 * Pure, so it is unit-testable without a terminal.
 */
export function normaliseSize(reading: {
	columns?: number | undefined;
	rows?: number | undefined;
}): TerminalSize {
	const columns = Math.max(MIN_COLUMNS, Math.floor(reading.columns ?? FALLBACK.columns));
	const rows = Math.max(MIN_ROWS, Math.floor(reading.rows ?? FALLBACK.rows));
	return { columns, rows };
}

/**
 * Live terminal size.
 *
 * Reads `process.stdout` directly rather than ink's `useStdout()`: under Bun the
 * stream returned by that hook does not expose `rows`/`columns`, and the size
 * would silently degrade to the fallback. See ADR-002.
 */
export function useTerminalSize(): TerminalSize {
	const [size, setSize] = useState<TerminalSize>(() => normaliseSize(process.stdout));

	useEffect(() => {
		const onResize = (): void => setSize(normaliseSize(process.stdout));
		process.stdout.on("resize", onResize);
		return () => {
			process.stdout.off("resize", onResize);
		};
	}, []);

	return size;
}
