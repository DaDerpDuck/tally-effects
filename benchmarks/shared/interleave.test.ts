import { describe, expect, it } from "vitest";
import { interleave } from "./interleave.js";

describe("interleaved benchmark execution", () => {
	it("alternates order, awaits each run, and keeps per-revision results in round order", async () => {
		const calls: string[] = [];
		let active = 0;
		let maxActive = 0;
		const results = await interleave(3, async (side, round) => {
			active++;
			maxActive = Math.max(maxActive, active);
			const id = `${side}-${round}`;
			calls.push(id);
			await Promise.resolve();
			active--;
			return id;
		});
		expect(maxActive).toBe(1);
		expect(calls).toEqual([
			"baseline-1",
			"candidate-1",
			"candidate-2",
			"baseline-2",
			"baseline-3",
			"candidate-3",
		]);
		expect(results).toEqual({
			baseline: ["baseline-1", "baseline-2", "baseline-3"],
			candidate: ["candidate-1", "candidate-2", "candidate-3"],
		});
	});

	it("stops on a failed run instead of silently comparing an incomplete sample", async () => {
		const calls: string[] = [];
		await expect(
			interleave(3, async (side, round) => {
				calls.push(`${side}-${round}`);
				if (side === "candidate") throw new Error("benchmark failed");
				return side;
			})
		).rejects.toThrow("benchmark failed");
		expect(calls).toEqual(["baseline-1", "candidate-1"]);
	});

	it.each([0, -1, 1.5, NaN, Infinity])(
		"rejects invalid run count %s before starting",
		async (count) => {
			let called = false;
			await expect(
				interleave(count, async () => {
					called = true;
				})
			).rejects.toThrow(/positive safe integer/);
			expect(called).toBe(false);
		}
	);
});
