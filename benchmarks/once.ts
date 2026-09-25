import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { parseLogLevel } from "./shared/cli.js";
import { runWithProgress } from "./shared/progress.js";

const { values } = parseArgs({
	options: {
		output: { type: "string" },
		profile: { type: "string", default: "default" },
		"log-level": { type: "string", default: "info" },
	},
	allowPositionals: true,
});

const runEntryPoint = fileURLToPath(new URL("./run.js", import.meta.url));
await runWithProgress(process.execPath, [runEntryPoint, ...process.argv.slice(2)], {
	logLevel: parseLogLevel(values["log-level"]),
	label: "benchmark run",
	completed: 0,
	total: 1,
});
