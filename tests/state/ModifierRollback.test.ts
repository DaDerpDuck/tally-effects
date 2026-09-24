import { describe, expect, it } from "vitest";
import {
	AgentState,
	defineNumberProperty,
	defineSourceType,
	testReporter,
	type ModifierContribution,
} from "../src/index.js";

describe("modifier allocation rollback", () => {
	it("removes a modifier allocated by a contribution that then throws during admission", () => {
		const Property = defineNumberProperty({
			name: "FailedAdmissionAllocation",
			defaultValue: 0,
		});
		const allocateThenThrow: ModifierContribution = {
			applyTo(registry, order) {
				Property.add(5).applyTo(registry, order);
				throw new Error("allocation failed");
			},
		};
		const Failing = defineSourceType<undefined>({
			name: "FailedAdmissionAllocationSource",
			priority: 100,
			contribute: () => [allocateThenThrow],
		});
		const Probe = defineSourceType<undefined>({
			name: "FailedAdmissionAllocationProbe",
			priority: 100,
			contribute: () => [Property.add(1)],
		});
		const agent = new AgentState(undefined, { reporter: testReporter });

		expect(() => agent.addSource(Failing)).toThrow("allocation failed");
		expect(agent.getSources(Failing)).toEqual(new Set());
		agent.addSource(Probe);
		expect(agent.get(Property)).toBe(1);
	});

	it("retains old modifiers when replacement allocation throws after adding a new one", () => {
		const Property = defineNumberProperty({ name: "FailedUpdateAllocation", defaultValue: 0 });
		const allocateThenThrow: ModifierContribution = {
			applyTo(registry, order) {
				Property.add(5).applyTo(registry, order);
				throw new Error("replacement allocation failed");
			},
		};
		const SourceType = defineSourceType<number>({
			name: "FailedUpdateAllocationSource",
			priority: 100,
			contribute: (data) => (data === 1 ? [Property.add(1)] : [allocateThenThrow]),
		});
		const Probe = defineSourceType<undefined>({
			name: "FailedUpdateAllocationProbe",
			priority: 100,
			contribute: () => [Property.add(1)],
		});
		const agent = new AgentState(undefined, { reporter: testReporter });
		const source = agent.addSource(SourceType, 1)!;

		expect(() => source.set(2)).toThrow("replacement allocation failed");
		expect(source.get()).toBe(1);
		agent.addSource(Probe);
		expect(agent.get(Property)).toBe(2);
	});
});
