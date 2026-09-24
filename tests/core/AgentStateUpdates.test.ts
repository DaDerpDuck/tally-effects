import { describe, expect, it, vi } from "vitest";
import {
	AgentState,
	defineNumberProperty,
	defineSourceType,
	testReporter,
	type Property,
	type ModifierContribution,
} from "../src/index.js";

describe("agent state", () => {
	it("coalesces source updates reentered by a source observer", () => {
		const Property = defineNumberProperty({
			name: "ReentrantSourceObserverProperty",
			defaultValue: 0,
		});
		const ReentrantSource = defineSourceType<number>({
			name: "ReentrantSourceObserver",
			priority: 100,
			contribute: (value) => [Property.override(value)],
			replication: {
				serialize: (value) => value,
				deserialize: (value) => value as number,
			},
		});
		const agent = new AgentState(undefined, { reporter: testReporter });
		const source = agent.addSource(ReentrantSource, 1)!;
		const sourceValues: number[] = [];
		const agentValues: number[] = [];
		const replicationValues: number[] = [];
		source.onUpdate((self) => {
			sourceValues.push(self.get());
			if (self.get() === 2) self.set(3);
		});
		agent.onSourceUpdated(() => agentValues.push(source.get()));
		agent.onReplicationEmit((event) => {
			if (event.target === "source" && event.event.kind === "updated")
				replicationValues.push(event.event.data as number);
		});

		source.set(2);

		expect(source.get()).toBe(3);
		expect(agent.get(Property)).toBe(3);
		expect(sourceValues).toEqual([2, 3]);
		expect(agentValues).toEqual([3]);
		expect(replicationValues).toEqual([3]);
	});
	it("throws and restores the prior Source state when contribution or modifier application fails", () => {
		const Property = defineNumberProperty({
			name: "SourceSetFailureProperty",
			defaultValue: 0,
		});
		const throwingModifier: ModifierContribution = {
			applyTo() {
				throw new Error("modifier application failed");
			},
		};
		const SourceType = defineSourceType<number>({
			name: "SourceSetFailure",
			priority: 100,
			contribute(value) {
				if (value === 2) throw new Error("contribution failed");
				if (value === 3) return [throwingModifier];
				return [Property.add(value)];
			},
		});
		const agent = new AgentState(undefined, { reporter: testReporter });
		const source = agent.addSource(SourceType, 1)!;
		const updated = vi.fn();
		source.onUpdate(updated);

		expect(() => source.set(2)).toThrow("contribution failed");
		expect(source.get()).toBe(1);
		expect(agent.get(Property)).toBe(1);

		expect(() => source.set(3)).toThrow("modifier application failed");
		expect(source.get()).toBe(1);
		expect(agent.get(Property)).toBe(1);
		expect(updated).not.toHaveBeenCalled();
	});
	it("propagates source equality failures without changing the source", () => {
		const SourceType = defineSourceType<number>({
			name: "ThrowingSourceEquality",
			priority: 100,
			contribute: () => [],
			dataEquals() {
				throw new Error("source equality failed");
			},
		});
		const agent = new AgentState(undefined, { reporter: testReporter });
		const source = agent.addSource(SourceType, 1)!;

		expect(() => source.set(2)).toThrow("source equality failed");
		expect(source.get()).toBe(1);
	});
});
