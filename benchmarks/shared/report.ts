export interface BenchmarkTaskReport {
	name: string;
	samples: number;
	latencyMedianNs: number;
	latencyMeanNs: number;
	latencyP99Ns: number;
	rme: number;
	operationsPerSample: number;
	warnings: string[];
}

export interface SuiteSettings {
	timeMs: number;
	iterations: number;
	warmupTimeMs: number;
	warmupIterations: number;
	timestampProvider: string;
}

export interface BenchmarkSuiteReport extends SuiteSettings {
	name: string;
	tasks: BenchmarkTaskReport[];
}

interface ReportMetadata {
	schemaVersion: 2;
	commit: string;
	dirty: boolean;
	profile: "quick" | "comparison";
	timestamp: string;
	environment: Record<string, string>;
}

export interface BenchmarkReport extends ReportMetadata {
	kind: "single";
	suites: BenchmarkSuiteReport[];
}

export interface AggregatedTaskReport {
	name: string;
	medianOfMedianNs: number;
	minMedianNs: number;
	maxMedianNs: number;
	runMedianNs: number[];
	madNs: number;
	relativeMadPercent: number | null;
	rangeSpreadPercent: number | null;
	operationsPerSample: number;
	warnings: string[];
}

export interface AggregatedReport extends ReportMetadata {
	kind: "aggregate";
	runs: number;
	suites: Array<SuiteSettings & { name: string; tasks: AggregatedTaskReport[] }>;
}

export function median(values: readonly number[]): number {
	if (values.length === 0 || values.some((value) => !Number.isFinite(value))) {
		throw new Error("Median requires a nonempty collection of finite numbers");
	}
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

export function aggregateReports(reports: readonly BenchmarkReport[]): AggregatedReport {
	const first = reports[0];
	if (!first) throw new Error("At least one benchmark report is required");

	// Refuse to combine runs whose workloads or measurement environment changed.
	const signature = (report: BenchmarkReport) =>
		JSON.stringify({
			commit: report.commit,
			dirty: report.dirty,
			profile: report.profile,
			environment: report.environment,
			suites: report.suites.map(({ tasks, ...suite }) => ({
				...suite,
				tasks: tasks.map(({ name, operationsPerSample }) => ({
					name,
					operationsPerSample,
				})),
			})),
		});
	const expected = signature(first);
	for (const report of reports) {
		if (
			report.schemaVersion !== 2 ||
			report.kind !== "single" ||
			signature(report) !== expected
		) {
			throw new Error(
				"Cannot aggregate runs with different revisions, environments, or workloads"
			);
		}
	}

	return {
		...first,
		kind: "aggregate",
		timestamp: new Date().toISOString(),
		runs: reports.length,
		suites: first.suites.map((suite, suiteIndex) => ({
			...suite,
			tasks: suite.tasks.map((task, taskIndex) => {
				const tasks = reports.map((report) => report.suites[suiteIndex]!.tasks[taskIndex]!);
				const runMedianNs = tasks.map((result) => result.latencyMedianNs);
				if (runMedianNs.some((value) => value < 0)) {
					throw new Error("Benchmark latencies cannot be negative");
				}
				const medianOfMedianNs = median(runMedianNs);
				const minMedianNs = Math.min(...runMedianNs);
				const maxMedianNs = Math.max(...runMedianNs);
				const madNs = median(
					runMedianNs.map((value) => Math.abs(value - medianOfMedianNs))
				);
				return {
					name: task.name,
					medianOfMedianNs,
					minMedianNs,
					maxMedianNs,
					runMedianNs,
					madNs,
					relativeMadPercent:
						medianOfMedianNs === 0 ? null : (madNs / medianOfMedianNs) * 100,
					rangeSpreadPercent:
						medianOfMedianNs === 0
							? null
							: ((maxMedianNs - minMedianNs) / medianOfMedianNs) * 100,
					operationsPerSample: task.operationsPerSample,
					warnings: [...new Set(tasks.flatMap((result) => result.warnings))],
				};
			}),
		})),
	};
}
