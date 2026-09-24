import { describe, expect, it, vi } from "vitest";
import { AgentState, defineSourceType, DuplicationGroup, testReporter } from "../src/index.js";

describe("DuplicationGroup replacement selection", () => {
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
		const agent = new AgentState(undefined, { reporter: testReporter });
		const first = agent.addSource(SourceType, 10)!;

		expect(agent.addSource(SourceType, 5)).toBeUndefined();
		expect(agent.getSources(SourceType)).toEqual(new Set([first]));

		const stronger = agent.addSource(SourceType, 20)!;
		expect(agent.getSources(SourceType)).toEqual(new Set([stronger]));
		expect(agent.getSources(SourceType)).not.toContain(first);
	});
	it("passes the newest candidate's rank to replaceIf", () => {
		const replaceIf = vi.fn(
			(existingRank: number, incomingRank: number) => incomingRank > existingRank
		);
		const group = new DuplicationGroup({
			policy: "replace",
			maxStack: 2,
			selector: "newest",
		});
		const SourceType = defineSourceType<number>({
			name: "ConditionalNewestGroupReplacementSource",
			priority: 100,
			duplication: group.member({
				rank: (value) => value,
				replaceIf,
			}),
			contribute: () => [],
		});
		const agent = new AgentState(undefined, { reporter: testReporter });
		const oldest = agent.addSource(SourceType, 100)!;
		const newest = agent.addSource(SourceType, 50)!;

		expect(agent.addSource(SourceType, 20)).toBeUndefined();
		expect(replaceIf).toHaveBeenLastCalledWith(50, 20);
		expect(agent.getSources(SourceType)).toEqual(new Set([oldest, newest]));
	});
	it("passes the oldest candidate's rank to replaceIf after swap removal reorders a bucket", () => {
		const replaceIf = vi.fn(
			(existingRank: number, incomingRank: number) => incomingRank > existingRank
		);
		const group = new DuplicationGroup({
			policy: "replace",
			maxStack: 3,
			selector: "oldest",
		});
		const SourceType = defineSourceType<number>({
			name: "ConditionalReorderedOldestGroupReplacementSource",
			priority: 100,
			duplication: group.member({
				rank: (value) => value,
				replaceIf,
			}),
			contribute: () => [],
		});
		const agent = new AgentState(undefined, { reporter: testReporter });
		const removed = agent.addSource(SourceType, 100)!;
		const oldest = agent.addSource(SourceType, 50)!;
		const middle = agent.addSource(SourceType, 30)!;
		removed.destroy();
		const newest = agent.addSource(SourceType, 40)!;

		expect(agent.addSource(SourceType, 20)).toBeUndefined();
		expect(replaceIf).toHaveBeenLastCalledWith(50, 20);
		expect(agent.getSources(SourceType)).toEqual(new Set([oldest, middle, newest]));
	});
});
