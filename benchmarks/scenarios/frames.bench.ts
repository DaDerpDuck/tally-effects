import { createBench, HEAVY_BENCH_OPTIONS, runBench } from "../shared/bench.js";
import { addScenario } from "../shared/scenario.js";
import { createFrameScenario } from "./frames.js";

const bench = createBench("Scenario: multi-agent frame", HEAVY_BENCH_OPTIONS);
for (const count of [10, 100, 1_000]) {
	for (const batched of [false, true]) {
		addScenario(bench, `${count} agents / ${batched ? "batched" : "unbatched"} frame`, () =>
			createFrameScenario(count, batched)
		);
	}
}
runBench(bench);
