import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { parseLogLevel, parseProfile, selectSuites } from "./shared/cli.js";
import { aggregateReports, type BenchmarkReport } from "./shared/report.js";

const { values, positionals } = parseArgs({
	options: {
		runs: { type: "string", default: "5" },
		output: { type: "string" },
		profile: { type: "string", default: "default" },
		"log-level": { type: "string", default: "warn" },
	},
	allowPositionals: true,
});

const runs = Number(values.runs);
if (!Number.isSafeInteger(runs) || runs < 1)
	throw new Error("--runs must be a positive safe integer");
const logLevel = parseLogLevel(values["log-level"]);
const profile = parseProfile(values.profile);
const requested = selectSuites(positionals);

if (runs < 3 && logLevel !== "silent") {
	console.warn("Fewer than three runs cannot meaningfully characterize run-to-run variability.");
}

const temporaryDirectory = await mkdtemp(join(tmpdir(), "tally-benchmarks-"));
const reports: BenchmarkReport[] = [];

try {
	for (let run = 1; run <= runs; run++) {
		const runOutput = join(temporaryDirectory, `run-${run}.json`);
		if (logLevel === "info") console.log(`\nRunning benchmarks (run ${run}/${runs})...`);

		execFileSync(
			process.execPath,
			[
				"--import",
				"tsx",
				"benchmarks/run.ts",
				...requested,
				"--output",
				runOutput,
				"--log-level",
				logLevel,
				"--profile",
				profile,
			],
			{ stdio: "inherit" }
		);
		reports.push(JSON.parse(await readFile(runOutput, "utf8")) as BenchmarkReport);
	}

	const report = aggregateReports(reports);
	const outputPath = resolve(
		values.output ??
			join("benchmarks", "results", `benchmark-${report.commit.slice(0, 8)}.json`)
	);
	await mkdir(dirname(outputPath), { recursive: true });
	await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
	if (logLevel === "info") console.log(`\nWrote aggregated results to ${outputPath}`);
} finally {
	await rm(temporaryDirectory, { recursive: true, force: true });
}
