import type { BenchmarkLogLevel, BenchmarkProfile } from "./bench.js";

export const suites = {
	duplication: () => import("../micro/duplication.bench.js"),
	lifecycle: () => import("../micro/lifecycle.bench.js"),
	resolution: () => import("../micro/resolution.bench.js"),
	replication: () => import("../micro/replication.bench.js"),
	combat: () => import("../scenarios/combat.bench.js"),
	frames: () => import("../scenarios/frames.bench.js"),
	sync: () => import("../scenarios/replication.bench.js"),
} as const;

export function selectSuites(requested: readonly string[]): Array<keyof typeof suites> {
	const names = requested.length === 0 ? Object.keys(suites) : requested;
	const expanded = names.flatMap((name) =>
		name === "scenarios" ? ["combat", "frames", "sync"] : [name]
	);
	for (const name of expanded) {
		if (!Object.hasOwn(suites, name)) {
			throw new Error(
				`Unknown benchmark suite "${name}". Expected: ${Object.keys(suites).join(", ")}, scenarios`
			);
		}
	}
	return [...new Set(expanded)] as Array<keyof typeof suites>;
}

export function parseLogLevel(value: string): BenchmarkLogLevel {
	if (value !== "silent" && value !== "warn" && value !== "info") {
		throw new Error(`Invalid log level "${value}". Expected silent, warn, or info.`);
	}
	return value;
}

export function parseProfile(value: string): BenchmarkProfile {
	if (value !== "default" && value !== "quick" && value !== "comparison") {
		throw new Error(
			`Invalid benchmark profile "${value}". Expected default, quick, or comparison.`
		);
	}
	return value;
}
