import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { renderComparison, type ComparisonReport } from "./shared/comparison.js";

const [, , baselinePath, candidatePath, requestedOutputPath, ...extra] = process.argv;
if (!baselinePath || !candidatePath || extra.length > 0) {
	throw new Error("Usage: compare.ts <baseline.json> <candidate.json> [output.md]");
}

const baseline = JSON.parse(await readFile(baselinePath, "utf8")) as ComparisonReport;
const candidate = JSON.parse(await readFile(candidatePath, "utf8")) as ComparisonReport;
const markdown = renderComparison(baseline, candidate);
const outputPath = resolve(
	requestedOutputPath ??
		join(
			"benchmarks",
			"results",
			`comparison-${baseline.commit.slice(0, 8)}-vs-${candidate.commit.slice(0, 8)}.md`
		)
);
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, markdown);
