import { describe, expect, it } from "vitest";
import {
	AgentState,
	defineSourceType,
	DuplicationGroup,
	type DuplicatePolicy,
	type Source,
	testReporter,
} from "../src/index.js";

describe("DuplicationGroup domains", () => {
	it("shares conflicts between member types while isolating different keys", () => {
		const group = new DuplicationGroup({ policy: "ignore", maxStack: 1 });
		const FirstType = defineSourceType<number>({
			name: "FirstGroupedSource",
			priority: 100,
			duplication: group.member(),
			contribute: () => [],
		});
		const SecondType = defineSourceType<number>({
			name: "SecondGroupedSource",
			priority: 100,
			duplication: group.member(),
			contribute: () => [],
		});
		const agent = new AgentState(undefined, { reporter: testReporter });

		const firstA = agent.addSource(FirstType, 1, { key: "a" })!;
		const secondB = agent.addSource(SecondType, 2, { key: "b" })!;

		expect(agent.addSource(SecondType, 3, { key: "a" })).toBeUndefined();
		expect(agent.getSources(FirstType)).toEqual(new Set([firstA]));
		expect(agent.getSources(SecondType)).toEqual(new Set([secondB]));

		firstA.destroy();
		const replacementA = agent.addSource(SecondType, 4, { key: "a" })!;
		expect(agent.getSources(SecondType)).toEqual(new Set([secondB, replacementA]));
	});
	it("uses each heterogeneous member's own rank function", () => {
		interface FireData {
			readonly heat: number;
		}
		interface PoisonData {
			readonly toxicity: number;
		}

		const group = new DuplicationGroup({
			policy: "replace",
			maxStack: 2,
			selector: "lowest",
		});
		const firePolicy = group.member({
			rank(data) {
				if (typeof data !== "object" || data === null || !("heat" in data)) {
					throw new Error("Fire rank received non-Fire data");
				}
				return Number(data.heat);
			},
		}) as unknown as DuplicatePolicy<Source<FireData>, FireData>;
		const poisonPolicy = group.member({
			rank(data) {
				if (typeof data !== "object" || data === null || !("toxicity" in data)) {
					throw new Error("Poison rank received non-Poison data");
				}
				return Number(data.toxicity);
			},
		}) as unknown as DuplicatePolicy<Source<PoisonData>, PoisonData>;
		const FireType = defineSourceType<FireData>({
			name: "HeterogeneousFireSource",
			priority: 100,
			duplication: firePolicy,
			contribute: () => [],
		});
		const PoisonType = defineSourceType<PoisonData>({
			name: "HeterogeneousPoisonSource",
			priority: 100,
			duplication: poisonPolicy,
			contribute: () => [],
		});
		const agent = new AgentState(undefined, { reporter: testReporter });
		const firstFire = agent.addSource(FireType, { heat: 10 }, { key: "damage" })!;
		const poison = agent.addSource(PoisonType, { toxicity: 1 }, { key: "damage" })!;

		const secondFire = agent.addSource(FireType, { heat: 5 }, { key: "damage" })!;

		expect(agent.getSources(FireType)).toEqual(new Set([firstFire, secondFire]));
		expect(agent.getSources(PoisonType)).not.toContain(poison);
	});
});
