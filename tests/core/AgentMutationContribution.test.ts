import { describe, expect, it } from "vitest";
import { mutationError } from "../fixtures/MutationGate.js";
import {
	AgentState,
	defineDescriptorType,
	defineSourceType,
	type ModifierContribution,
	testReporter,
} from "../src/index.js";

describe("restricted hook mutation reentrancy", () => {
	it("rejects admission from source contribution and rolls back the candidate", () => {
		const agent = new AgentState(undefined, { reporter: testReporter });
		const Nested = defineSourceType<undefined>({
			name: "NestedContributionAdmission",
			priority: 100,
			contribute: () => [],
		});
		const Restricted = defineSourceType<undefined>({
			name: "RestrictedContributionAdmission",
			priority: 100,
			contribute: () => {
				agent.addSource(Nested);
				return [];
			},
		});

		expect(() => agent.addSource(Restricted)).toThrow(mutationError("source-contribution"));
		expect(agent.getSources(Restricted)).toEqual(new Set());
		expect(agent.getSources(Nested)).toEqual(new Set());
	});
	it("rejects Source updates from source contribution", () => {
		const agent = new AgentState(undefined, { reporter: testReporter });
		const Existing = defineSourceType<number>({
			name: "ExistingContributionUpdate",
			priority: 100,
			contribute: () => [],
		});
		const existing = agent.addSource(Existing, 1)!;
		const Restricted = defineSourceType<undefined>({
			name: "RestrictedContributionUpdate",
			priority: 100,
			contribute: () => {
				existing.set(2);
				return [];
			},
		});

		expect(() => agent.addSource(Restricted)).toThrow(mutationError("source-contribution"));
		expect(existing.get()).toBe(1);
		expect(agent.getSources(Restricted)).toEqual(new Set());
	});
	it("rejects source mutation from data equality without changing either source", () => {
		const agent = new AgentState(undefined, { reporter: testReporter });
		const Nested = defineSourceType<undefined>({
			name: "NestedSourceEqualityAdmission",
			priority: 100,
			contribute: () => [],
		});
		const Restricted = defineSourceType<number>({
			name: "RestrictedSourceEquality",
			priority: 100,
			contribute: () => [],
			dataEquals: () => {
				agent.addSource(Nested);
				return false;
			},
		});
		const source = agent.addSource(Restricted, 1)!;

		expect(() => source.set(2)).toThrow(mutationError("source-data-equality"));
		expect(source.get()).toBe(1);
		expect(agent.getSources(Nested)).toEqual(new Set());
	});
	it("rejects descriptor mutation from data equality without changing the descriptor", () => {
		const agent = new AgentState(undefined, { reporter: testReporter });
		const Output = defineSourceType<number>({
			name: "RestrictedDescriptorEqualityOutput",
			priority: 100,
			contribute: () => [],
		});
		const Nested = defineSourceType<undefined>({
			name: "NestedDescriptorEqualityAdmission",
			priority: 100,
			contribute: () => [],
		});
		const Restricted = defineDescriptorType<number, number>({
			name: "RestrictedDescriptorEquality",
			source: Output,
			dataEquals: () => {
				agent.addSource(Nested);
				return false;
			},
		});
		agent.registerDescriptorHandler(Restricted, (ctx, data) => {
			const source = ctx.addSource(data)!;
			return { source, update: () => {}, destroy: () => source.destroy() };
		});
		const descriptor = agent.addDescriptor(Restricted, 1)!;

		expect(() => descriptor.set(2)).toThrow(mutationError("descriptor-data-equality"));
		expect(descriptor.get()).toBe(1);
		expect(agent.getSources(Nested)).toEqual(new Set());
	});
	it("rejects Source mutation from modifier allocation and rolls back allocated state", () => {
		const agent = new AgentState(undefined, { reporter: testReporter });
		const Nested = defineSourceType<undefined>({
			name: "NestedModifierAllocationAdmission",
			priority: 100,
			contribute: () => [],
		});
		const contribution: ModifierContribution = {
			applyTo() {
				agent.addSource(Nested);
				throw new Error("unreachable");
			},
		};
		const Restricted = defineSourceType<undefined>({
			name: "RestrictedModifierAllocation",
			priority: 100,
			contribute: () => [contribution],
		});

		expect(() => agent.addSource(Restricted)).toThrow(mutationError("modifier-allocation"));
		expect(agent.getSources(Restricted)).toEqual(new Set());
		expect(agent.getSources(Nested)).toEqual(new Set());
	});
});
