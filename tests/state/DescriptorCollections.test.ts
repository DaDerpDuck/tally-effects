import { describe, expect, it } from "vitest";
import {
	type DescriptorData,
	DescriptorSource,
	Value,
	ValueDescriptor,
	createAgentFixture,
	registerHandler,
} from "../fixtures/Descriptor.js";
import { AgentState, defineDescriptorType, testReporter } from "../src/index.js";

describe("descriptor lifecycle", () => {
	it("keeps multiple descriptors of the same type independent", () => {
		const { agent } = createAgentFixture();
		const first = agent.addDescriptor(ValueDescriptor, { value: 1 })!;
		const second = agent.addDescriptor(ValueDescriptor, { value: 10 })!;

		expect(agent.getDescriptors(ValueDescriptor).size).toBe(2);
		expect(agent.get(Value)).toBe(11);

		first.set({ value: 2 });

		expect(first.get()).toEqual({ value: 2 });
		expect(second.get()).toEqual({ value: 10 });
		expect(agent.get(Value)).toBe(12);
	});
	it("filters descriptors by type", () => {
		const { agent } = createAgentFixture();
		const OtherDescriptor = defineDescriptorType<DescriptorData, DescriptorData>({
			name: "OtherDescriptor",
			source: DescriptorSource,
			replication: ValueDescriptor.replication,
		});
		registerHandler(agent, OtherDescriptor);

		const first = agent.addDescriptor(ValueDescriptor, { value: 1 })!;
		const second = agent.addDescriptor(OtherDescriptor, { value: 2 })!;

		expect(agent.getDescriptors(ValueDescriptor)).toEqual(new Set([first]));
		expect(agent.getDescriptors(OtherDescriptor)).toEqual(new Set([second]));
		expect(agent.getDescriptors()).toEqual(new Set([first, second]));
	});
	it("destroys every descriptor binding when all descriptors are destroyed", () => {
		const agent = new AgentState<undefined>(undefined, { reporter: testReporter });
		const bindingDestroyed = registerHandler(agent);
		agent.addDescriptor(ValueDescriptor, { value: 1 });
		agent.addDescriptor(ValueDescriptor, { value: 2 });

		agent.destroyAllDescriptors();

		expect(bindingDestroyed).toHaveBeenCalledTimes(2);
		expect(agent.getDescriptors().size).toBe(0);
		expect(agent.getSources(DescriptorSource).size).toBe(0);
		expect(agent.get(Value)).toBe(0);
	});
	it("destroys a descriptor admitted by final property resolution during bulk teardown", () => {
		const { agent } = createAgentFixture();
		agent.addDescriptor(ValueDescriptor, { value: 1 });

		let admittedDuringTeardown = false;
		agent.onPropertyChanged(Value, (value) => {
			if (value !== 0 || admittedDuringTeardown) return;
			admittedDuringTeardown = true;
			agent.addDescriptor(ValueDescriptor, { value: 1 });
		});

		agent.destroyAllDescriptors();

		expect(admittedDuringTeardown).toBe(true);
		expect(agent.getDescriptors().size).toBe(0);
		expect(agent.getSources(DescriptorSource).size).toBe(0);
		expect(agent.get(Value)).toBe(0);
	});
});
