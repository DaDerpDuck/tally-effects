import { describe, expect, it, vi } from "vitest";
import {
	AgentState,
	defineDescriptorType,
	defineSourceType,
	DuplicationGroup,
	type DuplicatePolicy,
	type Source,
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
		const agent = new AgentState(undefined);

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
		const agent = new AgentState(undefined);
		const firstFire = agent.addSource(FireType, { heat: 10 }, { key: "damage" })!;
		const poison = agent.addSource(PoisonType, { toxicity: 1 }, { key: "damage" })!;

		const secondFire = agent.addSource(FireType, { heat: 5 }, { key: "damage" })!;

		expect(agent.getSources(FireType)).toEqual(new Set([firstFire, secondFire]));
		expect(agent.getSources(PoisonType)).not.toContain(poison);
	});
});

describe("DuplicationGroup replacement selection", () => {
	it("replaces the oldest candidate by default", () => {
		const group = new DuplicationGroup({ policy: "replace" });
		const SourceType = defineSourceType<number>({
			name: "DefaultGroupReplacementSource",
			priority: 100,
			duplication: group.member(),
			contribute: () => [],
		});
		const agent = new AgentState(undefined);
		const first = agent.addSource(SourceType, 1)!;

		const second = agent.addSource(SourceType, 2)!;

		expect(agent.getSources(SourceType)).toEqual(new Set([second]));
		expect(agent.getSources(SourceType)).not.toContain(first);
	});

	it("replaces the oldest candidate when the stack is full", () => {
		const group = new DuplicationGroup({
			policy: "replace",
			maxStack: 2,
			selector: "oldest",
		});
		const SourceType = defineSourceType<number>({
			name: "OldestGroupReplacementSource",
			priority: 100,
			duplication: group.member(),
			contribute: () => [],
		});
		const agent = new AgentState(undefined);
		const first = agent.addSource(SourceType, 1)!;
		const second = agent.addSource(SourceType, 2)!;

		const third = agent.addSource(SourceType, 3)!;

		expect(agent.getSources(SourceType)).toEqual(new Set([second, third]));
		expect(agent.getSources(SourceType)).not.toContain(first);
	});

	it("replaces the newest candidate when the stack is full", () => {
		const group = new DuplicationGroup({
			policy: "replace",
			maxStack: 2,
			selector: "newest",
		});
		const SourceType = defineSourceType<number>({
			name: "NewestGroupReplacementSource",
			priority: 100,
			duplication: group.member(),
			contribute: () => [],
		});
		const agent = new AgentState(undefined);
		const first = agent.addSource(SourceType, 1)!;
		const second = agent.addSource(SourceType, 2)!;

		const third = agent.addSource(SourceType, 3)!;

		expect(agent.getSources(SourceType)).toEqual(new Set([first, third]));
		expect(agent.getSources(SourceType)).not.toContain(second);
	});

	it("replaces the lowest-ranked candidate when the stack is full", () => {
		const group = new DuplicationGroup({
			policy: "replace",
			maxStack: 2,
			selector: "lowest",
		});
		const SourceType = defineSourceType<number>({
			name: "LowestGroupReplacementSource",
			priority: 100,
			duplication: group.member({ rank: (value) => value }),
			contribute: () => [],
		});
		const agent = new AgentState(undefined);
		const highest = agent.addSource(SourceType, 10)!;
		const lowest = agent.addSource(SourceType, 2)!;

		const incoming = agent.addSource(SourceType, 5)!;

		expect(agent.getSources(SourceType)).toEqual(new Set([highest, incoming]));
		expect(agent.getSources(SourceType)).not.toContain(lowest);
	});

	it("replaces the highest-ranked candidate when the stack is full", () => {
		const group = new DuplicationGroup({
			policy: "replace",
			maxStack: 2,
			selector: "highest",
		});
		const SourceType = defineSourceType<number>({
			name: "HighestGroupReplacementSource",
			priority: 100,
			duplication: group.member({ rank: (value) => value }),
			contribute: () => [],
		});
		const agent = new AgentState(undefined);
		const highest = agent.addSource(SourceType, 10)!;
		const lowest = agent.addSource(SourceType, 2)!;

		const incoming = agent.addSource(SourceType, 5)!;

		expect(agent.getSources(SourceType)).toEqual(new Set([lowest, incoming]));
		expect(agent.getSources(SourceType)).not.toContain(highest);
	});

	it("evicts the oldest candidate when lowest ranks are tied", () => {
		const group = new DuplicationGroup({
			policy: "replace",
			maxStack: 2,
			selector: "lowest",
		});
		const SourceType = defineSourceType<number>({
			name: "LowestTieBreakSource",
			priority: 100,
			duplication: group.member({ rank: () => 0 }),
			contribute: () => [],
		});
		const agent = new AgentState(undefined);
		const first = agent.addSource(SourceType, 1)!;
		const second = agent.addSource(SourceType, 2)!;

		const incoming = agent.addSource(SourceType, 3)!;

		expect(agent.getSources(SourceType)).toEqual(new Set([second, incoming]));
		expect(agent.getSources(SourceType)).not.toContain(first);
	});

	it("evicts the newest candidate when highest ranks are tied", () => {
		const group = new DuplicationGroup({
			policy: "replace",
			maxStack: 2,
			selector: "highest",
		});
		const SourceType = defineSourceType<number>({
			name: "HighestTieBreakSource",
			priority: 100,
			duplication: group.member({ rank: () => 0 }),
			contribute: () => [],
		});
		const agent = new AgentState(undefined);
		const first = agent.addSource(SourceType, 1)!;
		const second = agent.addSource(SourceType, 2)!;

		const incoming = agent.addSource(SourceType, 3)!;

		expect(agent.getSources(SourceType)).toEqual(new Set([first, incoming]));
		expect(agent.getSources(SourceType)).not.toContain(second);
	});

	it("uses replaceIf to reject weaker candidates and accept stronger candidates", () => {
		const group = new DuplicationGroup({
			policy: "replace",
			maxStack: 1,
			selector: "lowest",
		});
		const SourceType = defineSourceType<number>({
			name: "ConditionalGroupReplacementSource",
			priority: 100,
			duplication: group.member({
				rank: (value) => value,
				replaceIf: (existingRank, incomingRank) => incomingRank > existingRank,
			}),
			contribute: () => [],
		});
		const agent = new AgentState(undefined);
		const first = agent.addSource(SourceType, 10)!;

		expect(agent.addSource(SourceType, 5)).toBeUndefined();
		expect(agent.getSources(SourceType)).toEqual(new Set([first]));

		const stronger = agent.addSource(SourceType, 20)!;
		expect(agent.getSources(SourceType)).toEqual(new Set([stronger]));
		expect(agent.getSources(SourceType)).not.toContain(first);
	});
});

describe("heterogeneous DuplicationGroup lifecycle", () => {
	it("can evict Sources and Descriptors through the shared candidate contract", () => {
		const group = new DuplicationGroup({
			policy: "replace",
			maxStack: 1,
			selector: "newest",
		});
		const GroupedSourceType = defineSourceType<number>({
			name: "CrossKindGroupedSource",
			priority: 100,
			duplication: group.member({ rank: (value) => value }),
			contribute: () => [],
		});
		const OutputType = defineSourceType<number>({
			name: "CrossKindDescriptorOutput",
			priority: 100,
			contribute: () => [],
		});
		const DescriptorType = defineDescriptorType<number, number>({
			name: "CrossKindGroupedDescriptor",
			source: OutputType,
			duplication: group.member({ rank: (value) => value }),
		});
		const agent = new AgentState(undefined);
		const bindingDestroyed = vi.fn();
		agent.registerDescriptorHandler(DescriptorType, (ctx, data) => {
			const source = ctx.addSource(data)!;
			return {
				source,
				update(value) {
					source.set(value);
				},
				destroy() {
					bindingDestroyed();
					source.destroy();
				},
			};
		});
		const firstSource = agent.addSource(GroupedSourceType, 1, { key: "shared" })!;

		const descriptor = agent.addDescriptor(DescriptorType, 2, { key: "shared" })!;
		expect(agent.getSources(GroupedSourceType)).not.toContain(firstSource);
		expect(agent.getDescriptors(DescriptorType)).toEqual(new Set([descriptor]));

		const replacementSource = agent.addSource(GroupedSourceType, 3, { key: "shared" })!;
		expect(bindingDestroyed).toHaveBeenCalledOnce();
		expect(agent.getDescriptors(DescriptorType)).not.toContain(descriptor);
		expect(agent.getSources(GroupedSourceType)).toEqual(new Set([replacementSource]));
		expect(agent.getSources(OutputType).size).toBe(0);
	});
});
