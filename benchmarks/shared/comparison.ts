import type { SuiteSettings } from "./report.js";

// Optional fields keep schema-1 reports and single runs readable.
interface ComparisonTask {
	name: string;
	medianOfMedianNs?: number;
	latencyMedianNs?: number;
	relativeMadPercent?: number | null;
	relativeMad?: number | null;
	rangeSpreadPercent?: number | null;
	spreadPercent?: number | null;
	operationsPerSample?: number;
	warnings?: string[];
}

export interface ComparisonReport {
	schemaVersion: number;
	commit: string;
	dirty?: boolean;
	profile?: string;
	runs?: number;
	environment?: Record<string, unknown>;
	suites: Array<Partial<SuiteSettings> & { name: string; tasks: ComparisonTask[] }>;
}

const escape = (text: string) => text.replaceAll("|", "\\|").replace(/[\r\n]+/g, " ");

function latency(task: ComparisonTask): number {
	const value = task.medianOfMedianNs ?? task.latencyMedianNs;
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
		throw new Error(`Invalid or missing median for benchmark "${task.name}"`);
	}
	return value;
}

function indexReport(report: ComparisonReport) {
	if (report.schemaVersion !== 1 && report.schemaVersion !== 2) {
		throw new Error(`Unsupported benchmark schema: ${report.schemaVersion}`);
	}
	const tasks = new Map<
		string,
		{ suite: ComparisonReport["suites"][number]; task: ComparisonTask }
	>();
	for (const suite of report.suites) {
		for (const task of suite.tasks) {
			latency(task);
			const key = JSON.stringify([suite.name, task.name]);
			if (tasks.has(key)) throw new Error(`Duplicate benchmark "${suite.name}/${task.name}"`);
			tasks.set(key, { suite, task });
		}
	}
	if (tasks.size === 0) throw new Error("Benchmark report contains no tasks");
	return tasks;
}

function diagnostics(label: string, task: ComparisonTask, runs: number): string[] {
	const notes = (task.warnings ?? []).map((warning) => `${label}: ${warning}`);
	const mad = task.relativeMadPercent ?? task.relativeMad;
	if (runs < 3) notes.push(`${label}: fewer than 3 runs`);
	else if (mad === undefined || mad === null) notes.push(`${label}: relative MAD unavailable`);
	else if (mad > 1) notes.push(`${label}: relative MAD ${mad.toFixed(1)}%`);
	const spread = task.rangeSpreadPercent ?? task.spreadPercent;
	if (spread !== undefined && spread !== null && spread >= 20)
		notes.push(`${label}: range spread ${spread.toFixed(1)}%`);
	return notes;
}

export function renderComparison(baseline: ComparisonReport, candidate: ComparisonReport): string {
	const before = indexReport(baseline);
	const after = indexReport(candidate);
	const notes: string[] = [];
	const environmentDiffers =
		baseline.environment !== undefined &&
		candidate.environment !== undefined &&
		[
			...new Set([
				...Object.keys(baseline.environment),
				...Object.keys(candidate.environment),
			]),
		].some((key) => baseline.environment![key] !== candidate.environment![key]);
	const profileDiffers =
		baseline.profile !== undefined &&
		candidate.profile !== undefined &&
		baseline.profile !== candidate.profile;
	if (environmentDiffers)
		notes.push("Runtime or machine metadata differs; percentage comparisons are suppressed.");
	if (profileDiffers)
		notes.push("Benchmark profiles differ; percentage comparisons are suppressed.");
	if (baseline.schemaVersion === 1 || candidate.schemaVersion === 1)
		notes.push("Legacy report: complete measurement settings may be unavailable.");
	if (baseline.dirty || candidate.dirty)
		notes.push(
			"At least one report includes uncommitted changes; its commit hash does not identify all measured code."
		);

	const rows: string[] = [];
	for (const key of new Set([...before.keys(), ...after.keys()])) {
		const previous = before.get(key);
		const next = after.get(key);
		const entry = next ?? previous!;
		const label = escape(`${entry.suite.name}: ${entry.task.name}`);
		const previousNs = previous ? latency(previous.task) : undefined;
		const nextNs = next ? latency(next.task) : undefined;
		const remarks: string[] = [];
		let comparable =
			previous !== undefined && next !== undefined && !environmentDiffers && !profileDiffers;
		if (!previous) remarks.push("added");
		if (!next) remarks.push("removed");
		if (previous && next) {
			if ((previous.task.operationsPerSample ?? 1) !== (next.task.operationsPerSample ?? 1)) {
				remarks.push("batch size changed");
				comparable = false;
			}
			const settings: Array<keyof SuiteSettings> = [
				"timeMs",
				"iterations",
				"warmupTimeMs",
				"warmupIterations",
				"timestampProvider",
			];
			if (
				settings.some(
					(setting) =>
						previous.suite[setting] !== undefined &&
						next.suite[setting] !== undefined &&
						previous.suite[setting] !== next.suite[setting]
				)
			) {
				remarks.push("measurement settings differ");
				comparable = false;
			}
		}
		if (previous) remarks.push(...diagnostics("baseline", previous.task, baseline.runs ?? 1));
		if (next) remarks.push(...diagnostics("candidate", next.task, candidate.runs ?? 1));
		if (previousNs === 0 || nextNs === 0) {
			remarks.push("zero median: timing is unresolved");
			comparable = false;
		}
		const change = comparable ? (nextNs! / previousNs! - 1) * 100 : undefined;
		rows.push(
			`| ${label} | ${previousNs?.toFixed(2) ?? "n/a"} | ${nextNs?.toFixed(2) ?? "n/a"} | ` +
				`${change === undefined ? "n/a" : `${change >= 0 ? "+" : ""}${change.toFixed(1)}%`} | ${escape(remarks.join(", "))} |`
		);
	}

	return [
		"# Benchmark comparison",
		"",
		`Baseline: \`${baseline.commit.slice(0, 8)}\` (${baseline.runs ?? 1} runs, ${baseline.profile ?? "profile unknown"})`,
		"",
		`Candidate: \`${candidate.commit.slice(0, 8)}\` (${candidate.runs ?? 1} runs, ${candidate.profile ?? "profile unknown"})`,
		"",
		...notes.flatMap((note) => [`> ${note}`, ""]),
		"| Benchmark | Baseline median (ns/op) | Candidate median (ns/op) | Change | Remarks |",
		"|---|---:|---:|---:|---|",
		...rows,
		"",
		"Changes are descriptive, not statistical significance or a CI performance gate. Relative MAD above 1% is shown as a diagnostic, not an instability cutoff.",
		"",
	].join("\n");
}
