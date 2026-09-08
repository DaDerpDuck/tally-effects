import { describe, expect, it } from "vitest";
import { renderComparison, type ComparisonReport } from "./comparison.js";
import { aggregateReports, type BenchmarkReport } from "./report.js";

function report(first: number, second = 200): BenchmarkReport {
	return {
		schemaVersion: 2,
		kind: "single",
		commit: "12345678",
		dirty: false,
		profile: "comparison",
		timestamp: "2026-09-05T00:00:00Z",
		environment: { runtime: "node", runtimeVersion: "24", cpu: "test" },
		suites: [
			{
				name: "Example",
				timeMs: 250,
				iterations: 20,
				warmupTimeMs: 250,
				warmupIterations: 5,
				timestampProvider: "test",
				tasks: [first, second].map((value, index) => ({
					name: `task ${index}`,
					samples: 20,
					latencyMedianNs: value,
					latencyMeanNs: value,
					latencyP99Ns: value,
					rme: 0,
					operationsPerSample: 1,
					warnings: [],
				})),
			},
		],
	};
}

describe("benchmark aggregation", () => {
	it("aggregates each task independently and distinguishes MAD from range", () => {
		const input = [
			report(98, 300),
			report(100, 100),
			report(101, 200),
			report(102, 500),
			report(110, 400),
		];
		input[0]!.suites[0]!.tasks[0]!.warnings = ["zero-mad"];
		const tasks = aggregateReports(input).suites[0]!.tasks;
		expect(tasks[0]).toMatchObject({
			medianOfMedianNs: 101,
			madNs: 1,
			minMedianNs: 98,
			maxMedianNs: 110,
			warnings: ["zero-mad"],
		});
		expect(tasks[0]!.relativeMadPercent).toBeCloseTo(100 / 101);
		expect(tasks[0]!.rangeSpreadPercent).toBeCloseTo(1200 / 101);
		expect(tasks[1]!.medianOfMedianNs).toBe(300);
	});

	it("handles even run counts and unresolved zero latencies", () => {
		const tasks = aggregateReports([report(0, 100), report(0, 200)]).suites[0]!.tasks;
		expect(tasks[0]).toMatchObject({ relativeMadPercent: null, rangeSpreadPercent: null });
		expect(tasks[1]!.medianOfMedianNs).toBe(150);
	});

	it("rejects incompatible workloads, settings, and revisions instead of silently mixing them", () => {
		for (const mutate of [
			(value: BenchmarkReport) => {
				value.commit = "other";
			},
			(value: BenchmarkReport) => {
				value.suites[0]!.timeMs = 50;
			},
			(value: BenchmarkReport) => {
				value.suites[0]!.tasks[0]!.operationsPerSample = 100;
			},
			(value: BenchmarkReport) => {
				value.suites[0]!.tasks.pop();
			},
		]) {
			const changed = report(100);
			mutate(changed);
			expect(() => aggregateReports([report(100), changed])).toThrow(/different/);
		}
	});
});

describe("benchmark comparison", () => {
	it("shows baseline warnings and variability, plus added and removed tasks", () => {
		const baseline = aggregateReports([report(80), report(100), report(120)]);
		baseline.suites[0]!.tasks[0]!.warnings = ["zero-mad"];
		const candidate = aggregateReports([report(100), report(100), report(100)]);
		candidate.suites[0]!.tasks[1]!.name = "new task";
		const output = renderComparison(baseline, candidate);
		expect(output).toContain("baseline: zero-mad");
		expect(output).toContain("baseline: relative MAD 20.0%");
		expect(output).toContain("removed");
		expect(output).toContain("added");
	});

	it("reads legacy MAD, range-spread, and single-run reports", () => {
		for (const fields of [{ relativeMad: 2 }, { spreadPercent: 25 }]) {
			const legacy: ComparisonReport = {
				schemaVersion: 1,
				commit: "legacy",
				runs: 5,
				suites: [
					{
						name: "Example",
						tasks: [{ name: "task 0", medianOfMedianNs: 100, ...fields }],
					},
				],
			};
			const output = renderComparison(legacy, report(110));
			expect(output).toContain("+10.0%");
			expect(output).toContain("candidate: fewer than 3 runs");
		}
	});

	it("suppresses percentage changes for incompatible sampling and zero medians", () => {
		const candidate = report(110);
		candidate.suites[0]!.tasks[0]!.operationsPerSample = 100;
		const output = renderComparison(report(100, 0), candidate);
		expect(output).toContain("batch size changed");
		expect(output).toContain("zero median: timing is unresolved");
		expect(output).not.toContain("+10.0%");
		candidate.profile = "quick";
		expect(renderComparison(report(100), candidate)).toContain("profiles differ");
	});

	it("rejects invalid medians instead of generating NaN comparisons", () => {
		const candidate = report(Number.NaN);
		expect(() => renderComparison(report(100), candidate)).toThrow(/Invalid or missing median/);
	});
});
