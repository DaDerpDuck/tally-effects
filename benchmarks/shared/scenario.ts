import type { Bench } from "tinybench";

export interface Scenario {
	run(): void;
	verify(): void;
	destroy(): void;
}

/** One operation is a complete scenario invocation, with no per-agent normalization. */
export function addScenario(bench: Bench, name: string, create: () => Scenario): void {
	let scenario: Scenario;
	bench.add(name, () => scenario.run(), {
		async: false,
		beforeAll() {
			scenario = create();
			// Preflight outside timing so a broken fixture cannot produce a fast result.
			try {
				scenario.run();
				scenario.verify();
			} catch (error) {
				scenario.destroy();
				throw error;
			}
		},
		afterAll() {
			try {
				scenario.verify();
			} finally {
				scenario.destroy();
			}
		},
	});
}
