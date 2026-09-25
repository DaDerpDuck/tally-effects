import { describe, expect, it } from "vitest";
import { parseLogLevel } from "./cli.js";
import { formatElapsed, reportsProgress, runWithProgress } from "./progress.js";

describe("benchmark progress", () => {
	it("uses info and verbose for progress while preserving quieter levels", () => {
		expect(parseLogLevel("verbose")).toBe("verbose");
		expect(reportsProgress("silent")).toBe(false);
		expect(reportsProgress("warn")).toBe(false);
		expect(reportsProgress("info")).toBe(true);
		expect(reportsProgress("verbose")).toBe(true);
		expect(formatElapsed(125_000)).toBe("2:05");
	});

	it("reports periodic status and completed run counts outside the child", async () => {
		const lines: string[] = [];
		await runWithProgress(
			process.execPath,
			["-e", "Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100)"],
			{
				logLevel: "info",
				label: "round 2/3 candidate",
				completed: 3,
				total: 6,
				intervalMs: 10,
				report: (line) => lines.push(line),
			}
		);
		expect(lines[0]).toContain("3/6 runs complete; round 2/3 candidate running");
		expect(lines.length).toBeGreaterThan(2);
		expect(lines.at(-1)).toContain("4/6 runs complete; round 2/3 candidate finished");
	});

	it("keeps silent runs quiet and propagates child failures", async () => {
		const lines: string[] = [];
		await runWithProgress(process.execPath, ["-e", ""], {
			logLevel: "silent",
			label: "quiet run",
			completed: 0,
			total: 1,
			report: (line) => lines.push(line),
		});
		expect(lines).toEqual([]);

		await expect(
			runWithProgress(process.execPath, ["-e", "process.exit(7)"], {
				logLevel: "info",
				label: "failed run",
				completed: 0,
				total: 1,
				report: (line) => lines.push(line),
			})
		).rejects.toThrow("failed run exited with code 7");
		expect(lines.at(-1)).toContain("0/1 runs complete; failed run failed");
	});
});
