import { describe, expect, it, vi } from "vitest";
import {
	DescriptorSource,
	Value,
	ValueDescriptor,
	createAgentFixture,
} from "../fixtures/Descriptor.js";
import { AgentState, TallyContext, testReporter } from "../src/index.js";

describe("descriptor type", () => {
	it("references a SourceType rather than a runtime Source", () => {
		expect(ValueDescriptor.source).toBe(DescriptorSource);
	});
	it("registers descriptors by name", () => {
		const tally = new TallyContext<undefined>({ reporter: testReporter });
		tally.register(ValueDescriptor);

		expect(tally.descriptors.get("ValueDescriptor")).toBe(ValueDescriptor);
	});
	it("allows the same descriptor type instance to be registered repeatedly", () => {
		const tally = new TallyContext<undefined>({ reporter: testReporter });

		tally.register(ValueDescriptor);
		tally.register(ValueDescriptor);

		expect(tally.descriptors.size).toBe(1);
		expect(tally.descriptors.get("ValueDescriptor")).toBe(ValueDescriptor);
	});
});

describe("descriptor lifecycle", () => {
	it("requires a descriptor handler before creation", () => {
		const agent = new AgentState<undefined>(undefined, { reporter: testReporter });

		expect(() => agent.addDescriptor(ValueDescriptor, { value: 5 })).toThrow();
	});
	it("creates a descriptor and initializes its binding", () => {
		const { agent } = createAgentFixture();

		const descriptor = agent.addDescriptor(ValueDescriptor, { value: 5 })!;

		expect(descriptor.type).toBe(ValueDescriptor);
		expect(descriptor.get()).toEqual({ value: 5 });
		expect(descriptor.getSource().type).toBe(DescriptorSource);
		expect(descriptor.getSource().get()).toEqual({ value: 5 });
		expect(agent.get(Value)).toBe(5);
		expect(agent.getDescriptors(ValueDescriptor)).toEqual(new Set([descriptor]));
	});
	it("updates descriptor data and its binding", () => {
		const { agent } = createAgentFixture();
		const descriptor = agent.addDescriptor(ValueDescriptor, { value: 5 })!;
		const updated = vi.fn();
		descriptor.onUpdate(updated);

		descriptor.set({ value: 8 });

		expect(descriptor.get()).toEqual({ value: 8 });
		expect(descriptor.getSource().get()).toEqual({ value: 8 });
		expect(agent.get(Value)).toBe(8);
		expect(updated).toHaveBeenCalledTimes(1);
		expect(updated).toHaveBeenCalledWith(descriptor);
	});
});
