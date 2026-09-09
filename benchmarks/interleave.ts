import { execFileSync } from "node:child_process";
import {
	access,
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	realpath,
	rm,
	writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { parseLogLevel, parseProfile, selectSuites } from "./shared/cli.js";
import { renderComparison } from "./shared/comparison.js";
import { interleave, type BenchmarkSide } from "./shared/interleave.js";
import { aggregateReports, type BenchmarkReport } from "./shared/report.js";

const { values, positionals } = parseArgs({
	options: {
		baseline: { type: "string" },
		candidate: { type: "string", default: "." },
		runs: { type: "string", default: "7" },
		profile: { type: "string", default: "comparison" },
		"log-level": { type: "string", default: "warn" },
		output: { type: "string" },
	},
	allowPositionals: true,
});
if (!values.baseline) {
	throw new Error(
		"Usage: bench:interleave -- --baseline <checkout> [--candidate <checkout>] [suites] [--runs 7] [--output <empty-directory>]"
	);
}
const runs = Number(values.runs);
if (!Number.isSafeInteger(runs) || runs < 1)
	throw new Error("--runs must be a positive safe integer (runs per revision)");
const profile = parseProfile(values.profile);
const logLevel = parseLogLevel(values["log-level"]);
const requested = selectSuites(positionals);
const roots = {
	baseline: await realpath(resolve(values.baseline)),
	candidate: await realpath(resolve(values.candidate)),
};
if (roots.baseline === roots.candidate)
	throw new Error("Use two separate checkouts; they may point to the same commit.");

function git(root: string, ...args: string[]): string {
	return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}
const commits = {
	baseline: git(roots.baseline, "rev-parse", "HEAD"),
	candidate: git(roots.candidate, "rev-parse", "HEAD"),
};
for (const root of Object.values(roots)) {
	if ((await realpath(git(root, "rev-parse", "--show-toplevel"))) !== root) {
		throw new Error("Each checkout path must point to its repository root");
	}
	await access(join(root, "benchmarks", "run.ts"));
}
if (runs < 3 && logLevel !== "silent")
	console.warn("Fewer than three runs cannot meaningfully characterize run-to-run variability.");

// Results survive failures. Reject reuse so a partial run cannot look like an older success.
const resultsRoot = join(roots.candidate, "benchmarks", "results");
await mkdir(resultsRoot, { recursive: true });
const output = values.output
	? resolve(values.output)
	: await mkdtemp(
			join(
				resultsRoot,
				`interleaved-${commits.baseline.slice(0, 8)}-vs-${commits.candidate.slice(0, 8)}-`
			)
		);
await mkdir(output, { recursive: true });
if ((await readdir(output)).length > 0)
	throw new Error("--output must be an empty directory or a new path");
await mkdir(join(output, "runs"));

const require = createRequire(import.meta.url);
const compiler = require.resolve("typescript/lib/tsc.js");
const compilerVersion = (require("typescript/package.json") as { version: string }).version;
const buildDirectories: string[] = [];

async function build(root: string): Promise<string> {
	// Both revisions use this driver's compiler, but their own source, harness, and
	// root compiler settings. This also supports main before it has bench:build.
	const results = join(root, "benchmarks", "results");
	await mkdir(results, { recursive: true });
	const directory = await mkdtemp(join(results, ".interleave-build-"));
	buildDirectories.push(directory);
	const config = join(directory, "tsconfig.json");
	await writeFile(
		config,
		JSON.stringify(
			{
				extends: join(root, "tsconfig.json"),
				compilerOptions: {
					noEmit: false,
					rootDir: root,
					outDir: join(directory, "out"),
					types: ["node"],
					incremental: false,
					composite: false,
				},
				include: [join(root, "src/**/*.ts"), join(root, "benchmarks/**/*.ts")],
				exclude: [
					join(root, "benchmarks/results"),
					join(root, "benchmarks/.dist"),
					join(root, "benchmarks/**/*.test.ts"),
				],
			},
			null,
			2
		)
	);
	if (logLevel === "info") console.log(`Compiling ${root}`);
	execFileSync(process.execPath, [compiler, "-p", config], { cwd: root, stdio: "inherit" });
	return join(directory, "out", "benchmarks", "run.js");
}

const manifest = {
	schemaVersion: 1,
	strategy: "alternating-process-order",
	status: "running" as "running" | "completed" | "failed",
	runsPerRevision: runs,
	profile,
	suites: requested,
	checkouts: roots,
	commits,
	compiler: `typescript@${compilerVersion}`,
	executions: [] as Array<{
		round: number;
		side: BenchmarkSide;
		report: string;
		startedAt: string;
		finishedAt: string;
	}>,
};
const saveManifest = () =>
	writeFile(join(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

try {
	await saveManifest();
	const entries = {
		baseline: await build(roots.baseline),
		candidate: await build(roots.candidate),
	};
	const reports = await interleave(runs, async (side, round) => {
		if (git(roots[side], "rev-parse", "HEAD") !== commits[side])
			throw new Error(`${side} revision changed during the comparison`);
		const relativePath = `runs/${side}-${String(round).padStart(2, "0")}.json`;
		const reportPath = join(output, relativePath);
		const startedAt = new Date().toISOString();
		if (logLevel === "info") console.log(`Round ${round}/${runs}: ${side}`);
		execFileSync(
			process.execPath,
			[
				entries[side],
				...requested,
				"--profile",
				profile,
				"--log-level",
				logLevel,
				"--output",
				reportPath,
			],
			{ cwd: roots[side], stdio: "inherit" }
		);
		const report = JSON.parse(await readFile(reportPath, "utf8")) as BenchmarkReport;
		if (
			report.schemaVersion !== 2 ||
			report.kind !== "single" ||
			report.commit !== commits[side]
		) {
			throw new Error(`${side} must emit a schema-2 single report for the expected revision`);
		}
		// The driver knows the actual transform even when the older harness does not
		// report it. No source-loader fallback is used for either side.
		report.environment.execution = "tsc-emitted";
		report.environment.compiler = `typescript@${compilerVersion}`;
		await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
		manifest.executions.push({
			round,
			side,
			report: relativePath,
			startedAt,
			finishedAt: new Date().toISOString(),
		});
		await saveManifest();
		return report;
	});
	const baseline = aggregateReports(reports.baseline);
	const candidate = aggregateReports(reports.candidate);
	await writeFile(join(output, "baseline.json"), `${JSON.stringify(baseline, null, 2)}\n`);
	await writeFile(join(output, "candidate.json"), `${JSON.stringify(candidate, null, 2)}\n`);
	const comparison =
		renderComparison(baseline, candidate) +
		"\nRuns were interleaved baseline/candidate, then candidate/baseline, in fresh sequential processes. Changes compare the per-task medians across runs; they are not a paired significance test. See manifest.json and runs/ for order and raw results.\n";
	await writeFile(join(output, "comparison.md"), comparison);
	manifest.status = "completed";
	await saveManifest();
	if (logLevel === "info") console.log(`Wrote interleaved comparison to ${output}`);
} catch (error) {
	manifest.status = "failed";
	await saveManifest();
	throw error;
} finally {
	for (const directory of buildDirectories) await rm(directory, { recursive: true, force: true });
}
