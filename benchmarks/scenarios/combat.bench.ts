import { createBench, HEAVY_BENCH_OPTIONS, runBench } from "../shared/bench.js";
import { addScenario } from "../shared/scenario.js";
import { createCombatScenario } from "./combat.js";

const bench = createBench("Scenario: combat effect lifecycle", HEAVY_BENCH_OPTIONS);
for (const count of [1, 10, 100]) {
	for (const batched of [false, true]) {
		addScenario(bench, `${count} agents / ${batched ? "batched" : "unbatched"} encounter`, () =>
			createCombatScenario(count, batched)
		);
	}
}
runBench(bench);
