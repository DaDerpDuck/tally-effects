import { createBench, HEAVY_BENCH_OPTIONS, runBench } from "../shared/bench.js";
import { addScenario } from "../shared/scenario.js";
import { createSyncScenario } from "./replication.js";

const bench = createBench("Scenario: mixed replication churn", HEAVY_BENCH_OPTIONS);
for (const size of [10, 100, 1_000]) {
	for (const mode of ["snapshot", "events"] as const) {
		addScenario(bench, `${size} sources + ${size} descriptors / ${mode}`, () =>
			createSyncScenario(size, mode)
		);
	}
}
runBench(bench);
