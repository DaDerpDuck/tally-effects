import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
	createBenchmarkReport,
	setBenchmarkLogLevel,
	setBenchmarkProfile,
} from "./shared/bench.js";
import { parseLogLevel, parseProfile, selectSuites, suites } from "./shared/cli.js";

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

setBenchmarkLogLevel(parseLogLevel(values["log-level"]));
setBenchmarkProfile(parseProfile(values.profile));

const output = values.output;
const requested = selectSuites(positionals);

for (const suite of requested) {
	await suites[suite]();
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
