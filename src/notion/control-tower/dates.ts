// Shared ISO-date helpers for the control-tower module (addDays, diffDays,
// compareIsoDate). Extracted from local-portfolio-control-tower.ts (T3-4) so the
// config-parse and render/state-build seams can both depend on them.

export function addDays(date: string, days: number): string {
	const parsed = new Date(`${date}T00:00:00Z`);
	if (Number.isNaN(parsed.getTime())) {
		return "";
	}
	parsed.setUTCDate(parsed.getUTCDate() + days);
	return parsed.toISOString().slice(0, 10);
}

export function diffDays(fromDate: string, toDate: string): number {
	const from = new Date(`${fromDate}T00:00:00Z`);
	const to = new Date(`${toDate}T00:00:00Z`);
	if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
		return Number.MAX_SAFE_INTEGER;
	}
	return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}

export function compareIsoDate(left: string, right: string): number {
	if (!left && !right) {
		return 0;
	}
	if (!left) {
		return -1;
	}
	if (!right) {
		return 1;
	}
	return left.localeCompare(right);
}
