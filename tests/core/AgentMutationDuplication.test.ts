import { describe, expect, it } from "vitest";
import { mutationError } from "../fixtures/MutationGate.js";
import { AgentState, defineSourceType, DuplicationGroup, testReporter } from "../src/index.js";

describe("restricted hook mutation reentrancy", () => {
	it("rejects admission from duplication rank and leaves the current candidate live", () => {
		const agent = new AgentState(undefined, { reporter: testReporter });
		const group = new DuplicationGroup({
			policy: "replace",
			maxStack: 1,
			selector: "lowest",
		});
		let restricted = false;
		const SourceType = defineSourceType<number>({
			name: "RestrictedDuplicationRank",
			priority: 100,
			duplication: group.member({
				rank: (value) => {
					if (restricted) agent.addSource(SourceType, value + 1);
					return value;
				},
			}),
			contribute: () => [],
		});
		const first = agent.addSource(SourceType, 1)!;
		restricted = true;

		expect(() => agent.addSource(SourceType, 2)).toThrow(
			mutationError("duplication-policy-rank")
		);
		expect(agent.getSources(SourceType)).toEqual(new Set([first]));
	});
	it("rejects admission from duplication replacement selection", () => {
		const agent = new AgentState(undefined, { reporter: testReporter });
		const group = new DuplicationGroup({
			policy: "replace",
			maxStack: 1,
			selector: "oldest",
		});
		const SourceType = defineSourceType<number>({
			name: "RestrictedDuplicationReplacement",
			priority: 100,
			duplication: group.member({
				replaceIf: () => {
					agent.addSource(SourceType, 3);
					return true;
				},
			}),
			contribute: () => [],
		});
		const first = agent.addSource(SourceType, 1)!;

		expect(() => agent.addSource(SourceType, 2)).toThrow(
			mutationError("duplication-policy-replace-if")
		);
		expect(agent.getSources(SourceType)).toEqual(new Set([first]));
	});
});
