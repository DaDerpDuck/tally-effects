import { describe, expect, it } from "vitest";
import { AgentState, defineSourceType, DuplicationGroup, testReporter } from "../src/index.js";

describe("DuplicationGroup replacement selection", () => {
	it("replaces the oldest candidate by default", () => {
		const group = new DuplicationGroup({ policy: "replace" });
		const SourceType = defineSourceType<number>({
			name: "DefaultGroupReplacementSource",
			priority: 100,
			duplication: group.member(),
			contribute: () => [],
		});
		const agent = new AgentState(undefined, { reporter: testReporter });
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
		const agent = new AgentState(undefined, { reporter: testReporter });
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
		const agent = new AgentState(undefined, { reporter: testReporter });
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
		const agent = new AgentState(undefined, { reporter: testReporter });
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
		const agent = new AgentState(undefined, { reporter: testReporter });
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
		const agent = new AgentState(undefined, { reporter: testReporter });
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
		const agent = new AgentState(undefined, { reporter: testReporter });
		const first = agent.addSource(SourceType, 1)!;
		const second = agent.addSource(SourceType, 2)!;

		const incoming = agent.addSource(SourceType, 3)!;

		expect(agent.getSources(SourceType)).toEqual(new Set([first, incoming]));
		expect(agent.getSources(SourceType)).not.toContain(second);
	});
});
