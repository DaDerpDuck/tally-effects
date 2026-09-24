import { describe, expect, it } from "vitest";
import {
	AgentState,
	defineDescriptorType,
	defineNumberProperty,
	defineSourceType,
	DuplicationGroup,
	type ModifierContribution,
	createTestReporter,
	testReporter,
} from "../src/index.js";

const mutationError = (hook: string) => `Cannot mutate AgentState while evaluating ${hook}`;

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

	it("reports and retains the last cache when property resolution attempts mutation", () => {
		const { reporter, reports } = createTestReporter();
		const agent = new AgentState(undefined, { reporter });
		const Nested = defineSourceType<undefined>({
			name: "NestedPropertyResolutionAdmission",
			priority: 100,
			contribute: () => [],
		});
		const Property = defineNumberProperty({
			name: "RestrictedPropertyResolution",
			defaultValue: 0,
			valueEquals: Object.is,
			resolve: () => {
				agent.addSource(Nested);
				return 1;
			},
		});
		const Restricted = defineSourceType<undefined>({
			name: "RestrictedPropertyResolutionSource",
			priority: 100,
			contribute: () => [Property.add(1)],
		});

		expect(agent.addSource(Restricted)).toBeDefined();
		expect(agent.get(Property)).toBe(0);
		expect(agent.getSources(Nested)).toEqual(new Set());
		expect(reports).toHaveLength(2);
		expect(reports).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "property-resolution-failed",
					error: expect.objectContaining({
						message: mutationError("property-resolution"),
					}),
				}),
			])
		);

		const Unrelated = defineSourceType<undefined>({
			name: "PropertyResolutionRetryTrigger",
			priority: 100,
			contribute: () => [],
		});
		expect(agent.addSource(Unrelated)).toBeDefined();
		expect(reports).toHaveLength(4);
		expect(agent.get(Property)).toBe(0);
	});

	it("reports and retains the last cache when property equality attempts mutation", () => {
		const { reporter, reports } = createTestReporter();
		const agent = new AgentState(undefined, { reporter });
		const Nested = defineSourceType<undefined>({
			name: "NestedPropertyEqualityAdmission",
			priority: 100,
			contribute: () => [],
		});
		const Property = defineNumberProperty({
			name: "RestrictedPropertyEquality",
			defaultValue: 0,
			resolve: () => 1,
			valueEquals: () => {
				agent.addSource(Nested);
				return false;
			},
		});
		const Restricted = defineSourceType<undefined>({
			name: "RestrictedPropertyEqualitySource",
			priority: 100,
			contribute: () => [Property.add(1)],
		});

		expect(agent.addSource(Restricted)).toBeDefined();
		expect(agent.get(Property)).toBe(0);
		expect(agent.getSources(Nested)).toEqual(new Set());
		expect(reports).toHaveLength(2);
		expect(reports).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "property-equality-failed",
					error: expect.objectContaining({
						message: mutationError("property-equality"),
					}),
				}),
			])
		);

		const Unrelated = defineSourceType<undefined>({
			name: "PropertyEqualityRetryTrigger",
			priority: 100,
			contribute: () => [],
		});
		expect(agent.addSource(Unrelated)).toBeDefined();
		expect(reports).toHaveLength(4);
		expect(agent.get(Property)).toBe(0);
	});

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
