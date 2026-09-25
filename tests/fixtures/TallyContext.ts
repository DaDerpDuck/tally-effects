import { defineSourceType, TallyContext, testReporter } from "../src/index.js";

export interface PoisonData {
	intensity: number;
}

export const PoisonSource = defineSourceType<PoisonData>({
	name: "Poison",
	priority: 100,
	contribute: () => [],
	duplication: { policy: "ignore" },
});

export function createContextFixture(reporter = testReporter) {
	const tally = new TallyContext({ reporter });
	const agent = tally.createAgentState(undefined);
	return { agent, tally };
}
