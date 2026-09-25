import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { parseArgs } from "node:util";
import {
	createBenchmarkReport,
	setBenchmarkLogLevel,
	setBenchmarkProfile,
} from "./shared/bench.js";
import { parseLogLevel, parseProfile, selectSuites, suites } from "./shared/cli.js";
import { formatElapsed, reportsProgress, writeProgress } from "./shared/progress.js";

const { values, positionals } = parseArgs({
	options: {
		output: {
			type: "string",
		},
		profile: {
			type: "string",
			default: "default",
		},
		"log-level": {
			type: "string",
			default: "info",
		},
	},
	allowPositionals: true,
});

const logLevel = parseLogLevel(values["log-level"]);
// An interleaved driver can compare against a checkout that only knows the old
// info level. These flags let a newer baseline keep the requested output too.
const showProgress =
	reportsProgress(logLevel) || process.env.TALLY_BENCH_PROGRESS_FOR_BASELINE === "1";
setBenchmarkLogLevel(process.env.TALLY_BENCH_TABLES_FOR_BASELINE === "1" ? "verbose" : logLevel);
setBenchmarkProfile(parseProfile(values.profile));

const output = values.output;
const requested = selectSuites(positionals);
const startedAt = performance.now();

for (const [index, suite] of requested.entries()) {
	if (showProgress)
		writeProgress(
			`${index}/${requested.length} suites complete; starting ${suite}; elapsed ${formatElapsed(performance.now() - startedAt)}`
		);
	await suites[suite]();
	if (showProgress)
		writeProgress(
			`${index + 1}/${requested.length} suites complete; finished ${suite}; elapsed ${formatElapsed(performance.now() - startedAt)}`
		);
}

if (output) {
	const commit = execFileSync("git", ["rev-parse", "HEAD"], {
		encoding: "utf8",
	}).trim();

	const outputPath = resolve(output);
	const dirty =
		execFileSync("git", ["status", "--porcelain", "--untracked-files=normal"], {
			encoding: "utf8",
		}).trim().length > 0;
	await mkdir(dirname(outputPath), { recursive: true });
	await writeFile(
		outputPath,
		`${JSON.stringify(createBenchmarkReport(commit, dirty), null, 2)}\n`
	);
}

export {};
