import assert from "node:assert/strict";
import { AgentState, type NumberProperty, type Source } from "../../src/index.js";
import { BENCH_SIZES, createBench, HEAVY_BENCH_OPTIONS, runBench } from "../shared/bench.js";
import { createNumberSourceFixture } from "../shared/fixtures.js";

for (const position of ["last", "middle"] as const) {
	const resolution = createBench(
		position === "last"
			? "Property resolution: update one modifier"
			: "Property resolution: update middle modifier",
		{ ...HEAVY_BENCH_OPTIONS, iterations: 128 }
	);
	for (const size of BENCH_SIZES) {
		if (position === "middle" && size === 1) continue;
		let agent: AgentState<undefined>;
		let property: NumberProperty;
		let target: Source<number>;
		let value = 1;
		resolution.add(
			`${size} total modifiers`,
			() => {
				value = value === 1 ? 2 : 1;
				target.set(value);
			},
			{
				async: false,
				beforeAll() {
					const fixture = createNumberSourceFixture();
					({ agent, property } = fixture);
					value = 1;
					const targetIndex = position === "last" ? size - 1 : Math.floor(size / 2);
					agent.batch(() => {
						for (let i = 0; i < size; i++) {
							const source = agent.addSource(fixture.type, 1)!;
							if (i === targetIndex) target = source;
						}
					});
				},
				afterAll() {
					try {
						assert.equal(agent.get(property), size - 1 + value);
					} finally {
						agent.destroy();
					}
				},
			}
		);
	}
	runBench(resolution);
}
