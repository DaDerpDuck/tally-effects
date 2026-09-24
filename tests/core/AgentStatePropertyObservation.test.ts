import { describe, expect, it, vi } from "vitest";
import { Poison, PoisonSource } from "../fixtures/AgentState.js";
import { AgentState, defineNumberProperty, defineSourceType, testReporter } from "../src/index.js";

describe("agent state", () => {
	it("has property observation on source add", () => {
		const agent = new AgentState(undefined, { reporter: testReporter });
		const callback = vi.fn();

		agent.onPropertyChanged(Poison, callback);
		agent.addSource(PoisonSource, { intensity: 5 });

		expect(callback).toHaveBeenCalledWith(5, 0);
	});
	it("has property observation on source set", () => {
		const agent = new AgentState(undefined, { reporter: testReporter });
		const callback = vi.fn();

		agent.onPropertyChanged(Poison, callback);

		const poisonSource = agent.addSource(PoisonSource, { intensity: 5 })!;
		expect(callback).toHaveBeenCalledTimes(1);
		expect(callback).toHaveBeenCalledWith(5, 0);

		poisonSource.set({ intensity: 2 });
		expect(callback).toHaveBeenCalledTimes(2);
		expect(callback).toHaveBeenCalledWith(2, 5);
	});
	it("has no-op property observation on source set", () => {
		const agent = new AgentState(undefined, { reporter: testReporter });
		const callback = vi.fn();

		agent.onPropertyChanged(Poison, callback);

		const poisonSource = agent.addSource(PoisonSource, { intensity: 5 })!;
		expect(callback).toHaveBeenCalledTimes(1);
		expect(callback).toHaveBeenCalledWith(5, 0);

		poisonSource.set({ intensity: 5 });
		expect(callback).toHaveBeenCalledTimes(1);
	});
	it("uses property value equality only for change notifications", () => {
		const Property = defineNumberProperty({
			name: "ApproximatePropertyEquality",
			defaultValue: 0,
			valueEquals: (a, b) => Math.floor(a) === Math.floor(b),
		});
		const SourceType = defineSourceType<number>({
			name: "ApproximatePropertySource",
			priority: 100,
			contribute: (value) => [Property.override(value)],
		});
		const agent = new AgentState(undefined, { reporter: testReporter });
		const changed = vi.fn();
		agent.onPropertyChanged(Property, changed);
		const source = agent.addSource(SourceType, 1.1)!;
		expect(changed).toHaveBeenCalledTimes(1);

		source.set(1.2);
		expect(agent.get(Property)).toBe(1.2);
		expect(changed).toHaveBeenCalledTimes(1);

		source.set(2.1);
		expect(agent.get(Property)).toBe(2.1);
		expect(changed).toHaveBeenCalledTimes(2);
	});
	it("has property observation on source destroy", () => {
		const agent = new AgentState(undefined, { reporter: testReporter });
		const callback = vi.fn();

		agent.onPropertyChanged(Poison, callback);

		const poisonSource = agent.addSource(PoisonSource, { intensity: 5 })!;
		expect(callback).toHaveBeenCalledTimes(1);
		expect(callback).toHaveBeenCalledWith(5, 0);

		poisonSource.destroy();
		expect(callback).toHaveBeenCalledTimes(2);
		expect(callback).toHaveBeenCalledWith(0, 5);
	});
	it("does not notify a disconnected property observer more than once", () => {
		const Property = defineNumberProperty({ name: "DisconnectProperty", defaultValue: 0 });
		const SourceType = defineSourceType<number>({
			name: "DisconnectSource",
			priority: 100,
			contribute: (value) => [Property.add(value)],
		});
		const agent = new AgentState(undefined, { reporter: testReporter });
		const callback = vi.fn();
		const disconnect = agent.onPropertyChanged(Property, callback);

		disconnect();
		disconnect();
		agent.addSource(SourceType, 1);

		expect(callback).not.toHaveBeenCalled();
	});
});
