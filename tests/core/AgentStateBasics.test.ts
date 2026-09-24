import { describe, expect, it, vi } from "vitest";
import { Poison, PoisonSource } from "../fixtures/AgentState.js";
import {
	AgentState,
	defineBooleanProperty,
	defineNumberProperty,
	defineSourceType,
	testReporter,
} from "../src/index.js";

describe("agent state", () => {
	it("adds source", () => {
		const agent = new AgentState(undefined, { reporter: testReporter });
		expect(agent.get(Poison)).toBe(0);

		const source = agent.addSource(PoisonSource, { intensity: 5 });
		expect(source).toBeDefined();
		expect(agent.get(Poison)).toBe(5);
	});
	it("resolves source with falsy cache (number)", () => {
		const agent = new AgentState(undefined, { reporter: testReporter });
		expect(agent.get(Poison)).toBe(0);

		const source = agent.addSource(PoisonSource, { intensity: 5 })!;
		expect(agent.get(Poison)).toBe(5);

		source.set({ intensity: 0 });
		expect(agent.get(Poison)).toBe(0);

		source.set({ intensity: 5 });
		expect(agent.get(Poison)).toBe(5);

		source.destroy();
		expect(agent.get(Poison)).toBe(0);
	});
	it("resolves source with falsy cache (boolean)", () => {
		const BooleanProp = defineBooleanProperty({ name: "Boolean", defaultValue: false });

		const BooleanSource = defineSourceType<boolean>({
			name: "BooleanSource",
			priority: 100,
			contribute: (data) => [BooleanProp.toggle(data)],
		});

		const agent = new AgentState(undefined, { reporter: testReporter });
		expect(agent.get(BooleanProp)).toBe(false);

		const source = agent.addSource(BooleanSource, true)!;
		expect(agent.get(BooleanProp)).toBe(true);

		source.set(false);
		expect(agent.get(BooleanProp)).toBe(false);

		source.set(true);
		expect(agent.get(BooleanProp)).toBe(true);

		source.destroy();
		expect(agent.get(BooleanProp)).toBe(false);
	});
	it("handles dynamic source contribution shape", () => {
		const Prop1 = defineNumberProperty({ name: "Prop1", defaultValue: 10 });
		const Prop2 = defineNumberProperty({ name: "Prop2", defaultValue: 20 });

		const PropSource = defineSourceType<boolean>({
			name: "PropSource",
			priority: 100,
			contribute(data) {
				if (data) return [Prop1.add(1), Prop2.add(1)];
				else return [Prop1.add(1)];
			},
		});

		const agent = new AgentState(undefined, { reporter: testReporter });
		expect(agent.get(Prop1)).toBe(10);
		expect(agent.get(Prop2)).toBe(20);

		const source = agent.addSource(PropSource, true)!;
		expect(agent.get(Prop1)).toBe(11);
		expect(agent.get(Prop2)).toBe(21);

		source.set(false);
		expect(agent.get(Prop1)).toBe(11);
		expect(agent.get(Prop2)).toBe(20);

		source.destroy();
		expect(agent.get(Prop1)).toBe(10);
		expect(agent.get(Prop2)).toBe(20);
	});
	it("handles duplicate source identities", () => {
		const NumProp = defineNumberProperty({ name: "NumProp", defaultValue: 0 });

		const PropSource = defineSourceType<number>({
			name: "PropSource",
			priority: 100,
			contribute: (data) => [NumProp.add(data)],
			duplication: { policy: "allow" },
		});

		const agent = new AgentState(undefined, { reporter: testReporter });
		expect(agent.get(NumProp)).toBe(0);

		const source1 = agent.addSource(PropSource, 1)!;
		expect(source1).toBeDefined();
		expect(agent.get(NumProp)).toBe(1);

		const source2 = agent.addSource(PropSource, 10)!;
		expect(source2).toBeDefined();
		expect(agent.get(NumProp)).toBe(11);

		const source3 = agent.addSource(PropSource, 100)!;
		expect(source3).toBeDefined();
		expect(agent.get(NumProp)).toBe(111);

		source2.set(20);
		expect(agent.get(NumProp)).toBe(121);

		source1.set(2);
		expect(agent.get(NumProp)).toBe(122);

		source3.set(200);
		expect(agent.get(NumProp)).toBe(222);
	});
	it("uses Object.is as the default source data equality", () => {
		const SourceType = defineSourceType<{ value: number }>({
			name: "DefaultSourceEquality",
			priority: 100,
			contribute: () => [],
		});
		const agent = new AgentState(undefined, { reporter: testReporter });
		const initial = { value: 1 };
		const source = agent.addSource(SourceType, initial)!;
		const updated = vi.fn();
		source.onUpdate(updated);

		source.set(initial);
		expect(updated).not.toHaveBeenCalled();

		source.set({ value: 1 });
		expect(updated).toHaveBeenCalledTimes(1);
	});
	it("uses custom source data equality to suppress updates", () => {
		const SourceType = defineSourceType<{ value: number; label: string }>({
			name: "CustomSourceEquality",
			priority: 100,
			contribute: () => [],
			dataEquals: (a, b) => a.value === b.value,
		});
		const agent = new AgentState(undefined, { reporter: testReporter });
		const source = agent.addSource(SourceType, { value: 1, label: "first" })!;
		const updated = vi.fn();
		source.onUpdate(updated);

		source.set({ value: 1, label: "second" });
		expect(updated).not.toHaveBeenCalled();

		source.set({ value: 2, label: "second" });
		expect(updated).toHaveBeenCalledTimes(1);
	});
});
