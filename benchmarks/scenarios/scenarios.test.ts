import { describe, it } from "vitest";
import { createCombatScenario } from "./combat.js";
import { createFrameScenario } from "./frames.js";
import { createSyncScenario } from "./replication.js";

// Verify repeated state transitions without timing assertions or running Tinybench in CI.
describe("benchmark scenario fixtures", () => {
	for (const batched of [false, true]) {
		for (const [name, create] of [
			["combat", () => createCombatScenario(3, batched)],
			["frame", () => createFrameScenario(3, batched)],
		] as const) {
			it(`${name} stays correct over repeated ${batched ? "batched" : "unbatched"} cycles`, () => {
				const scenario = create();
				try {
					for (let i = 0; i < 20; i++) {
						scenario.run();
						scenario.verify();
					}
				} finally {
					scenario.destroy();
				}
			});
		}
	}
	for (const mode of ["snapshot", "events"] as const) {
		it(`mixed ${mode} converge through repeated ID churn without echoing replicated state`, () => {
			const scenario = createSyncScenario(5, mode);
			try {
				for (let i = 0; i < 20; i++) {
					scenario.run();
					scenario.verify();
				}
			} finally {
				scenario.destroy();
			}
		});
	}
});
