import { describe, expect, it, vi } from "vitest";
import {
	AgentState,
	createTestReporter,
	defineNumberProperty,
	defineSourceType,
	type ModifierContribution,
	testReporter,
} from "../src/index.js";

describe("failed preparation and contribution rollback", () => {
	it("rolls back earlier modifier handles when a later contribution throws", () => {
		const Property = defineNumberProperty({
			name: "PartialModifierApplicationProperty",
			defaultValue: 0,
		});
		const throwingContribution: ModifierContribution = {
			applyTo() {
				throw new Error("second modifier failed");
			},
		};
		const SourceType = defineSourceType<number>({
			name: "PartialModifierApplicationSource",
			priority: 100,
			contribute: (value) =>
				value === 1 ? [Property.add(1), throwingContribution] : [Property.add(value)],
		});
		const { reporter, reports } = createTestReporter();
		const agent = new AgentState(undefined, { reporter });

		expect(() => agent.addSource(SourceType, 1)).toThrow("second modifier failed");
		expect(agent.getSources(SourceType)).toEqual(new Set());
		expect(agent.get(Property)).toBe(0);

		agent.addSource(SourceType, 2);
		expect(agent.get(Property)).toBe(2);
	});

	it("notifies Source removal after property resolution observers throw", () => {
		const Property = defineNumberProperty({
			name: "ThrowingRemovalResolutionProperty",
			defaultValue: 0,
		});
		const SourceType = defineSourceType<number>({
			name: "ThrowingRemovalResolutionSource",
			priority: 100,
			contribute: (value) => [Property.add(value)],
		});
		const agent = new AgentState(undefined, { reporter: testReporter });
		const source = agent.addSource(SourceType, 1)!;
		const destroyed = vi.fn();
		const removed = vi.fn();
		source.onDestroy(destroyed);
		agent.onSourceRemoved(removed);
		agent.onPropertyChanged(Property, (value) => {
			if (value === 0) throw new Error("removal resolution failed");
		});

		expect(() => source.destroy()).not.toThrow();
		expect(destroyed).toHaveBeenCalledWith(source);
		expect(removed).toHaveBeenCalledWith(source);
		expect(agent.getSources(SourceType)).toEqual(new Set());
		expect(agent.get(Property)).toBe(0);
	});
});
