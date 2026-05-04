import { describe, expect, test } from "vitest";

import { mapWithConcurrency } from "../src/utils/concurrency.js";

describe("mapWithConcurrency", () => {
	test("preserves item order while running bounded parallel workers", async () => {
		let active = 0;
		let maxActive = 0;
		const results = await mapWithConcurrency([1, 2, 3, 4], 2, async (item) => {
			active += 1;
			maxActive = Math.max(maxActive, active);
			await new Promise((resolve) => setTimeout(resolve, 1));
			active -= 1;
			return item * 10;
		});

		expect(results).toEqual([10, 20, 30, 40]);
		expect(maxActive).toBeLessThanOrEqual(2);
	});
});
