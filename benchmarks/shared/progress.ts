import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import type { BenchmarkLogLevel } from "./bench.js";

export function reportsProgress(level: BenchmarkLogLevel): boolean {
	return level === "info" || level === "verbose";
}

export function formatElapsed(milliseconds: number): string {
	const seconds = Math.floor(milliseconds / 1000);
	const minutes = Math.floor(seconds / 60);
	return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

export function writeProgress(message: string): void {
	process.stderr.write(`[benchmark progress] ${message}\n`);
}

export interface ProgressRunOptions {
	readonly logLevel: BenchmarkLogLevel;
	readonly label: string;
	readonly completed: number;
	readonly total: number;
	readonly cwd?: string;
	readonly env?: NodeJS.ProcessEnv;
	readonly intervalMs?: number;
	readonly report?: (message: string) => void;
}

export async function runWithProgress(
	command: string,
	args: readonly string[],
	options: ProgressRunOptions
): Promise<void> {
	const start = performance.now();
	const enabled = reportsProgress(options.logLevel);
	const report = options.report ?? writeProgress;
	const elapsed = () => formatElapsed(performance.now() - start);
	const current = () =>
		`${options.completed}/${options.total} runs complete; ${options.label} running; run elapsed ${elapsed()}`;

	if (enabled) report(current());
	const timer = enabled
		? setInterval(() => report(current()), options.intervalMs ?? 30_000)
		: undefined;

	try {
		const child = spawn(command, [...args], {
			cwd: options.cwd,
			env: options.env,
			stdio: "inherit",
		});
		await new Promise<void>((resolve, reject) => {
			child.once("error", reject);
			child.once("close", (code, signal) => {
				if (code === 0) resolve();
				else reject(new Error(`${options.label} exited with ${signal ?? `code ${code}`}`));
			});
		});
		if (enabled)
			report(
				`${options.completed + 1}/${options.total} runs complete; ${options.label} finished; run elapsed ${elapsed()}`
			);
	} catch (error) {
		if (enabled)
			report(
				`${options.completed}/${options.total} runs complete; ${options.label} failed; run elapsed ${elapsed()}`
			);
		throw error;
	} finally {
		if (timer) clearInterval(timer);
	}
}
