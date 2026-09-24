import { describe, expect, it } from "vitest";
import {
	AgentState,
	defineDescriptorType,
	defineNumberProperty,
	defineSourceType,
	testReporter,
} from "../src/index.js";

describe("Source admission and teardown reentrancy", () => {
	it("resolves properties after rolling back a Source whose added observer throws", () => {
		const Property = defineNumberProperty({
			name: "ThrowingAddedSourceRollbackResolutionProperty",
			defaultValue: 0,
		});
		const SourceType = defineSourceType<number>({
			name: "ThrowingAddedSourceRollbackResolution",
			priority: 100,
			duplication: { policy: "ignore" },
			contribute: (value) => [Property.add(value)],
		});
		const agent = new AgentState(undefined, { reporter: testReporter });
		agent.onSourceAdded(() => {
			throw new Error("added callback failed");
		});

		expect(() => agent.addSource(SourceType, 1)).not.toThrow();
		expect(agent.getSources(SourceType).size).toBe(1);
		expect(agent.get(Property)).toBe(1);
	});

	it("resolves properties after rolling back a Descriptor whose added observer throws", () => {
		const Property = defineNumberProperty({
			name: "ThrowingAddedDescriptorRollbackResolutionProperty",
			defaultValue: 0,
		});
		const OutputType = defineSourceType<number>({
			name: "ThrowingAddedDescriptorRollbackResolutionOutput",
			priority: 100,
			contribute: (value) => [Property.add(value)],
		});
		const DescriptorType = defineDescriptorType<number, number>({
			name: "ThrowingAddedDescriptorRollbackResolution",
			source: OutputType,
			duplication: { policy: "ignore" },
		});
		const agent = new AgentState<undefined>(undefined, { reporter: testReporter });
		agent.registerDescriptorHandler(DescriptorType, (ctx, data) => {
			const source = ctx.addSource(data)!;
			return {
				source,
				update: (value) => source.set(value),
				destroy: () => source.destroy(),
			};
		});
		agent.onDescriptorAdded(() => {
			throw new Error("added callback failed");
		});

		expect(() => agent.addDescriptor(DescriptorType, 1)).not.toThrow();
		expect(agent.getDescriptors(DescriptorType).size).toBe(1);
		expect(agent.getSources(OutputType).size).toBe(1);
		expect(agent.get(Property)).toBe(1);
	});

	it("reports a Source property observer failure after admission", () => {
		const Property = defineNumberProperty({
			name: "ThrowingAdmissionFlushSourceProperty",
			defaultValue: 0,
		});
		const SourceType = defineSourceType<number>({
			name: "ThrowingAdmissionFlushSource",
			priority: 100,
			duplication: { policy: "ignore" },
			contribute: (value) => [Property.add(value)],
		});
		const agent = new AgentState(undefined, { reporter: testReporter });
		agent.onPropertyChanged(Property, (value) => {
			if (value === 1) throw new Error("admission flush failed");
		});

		expect(() => agent.addSource(SourceType, 1)).not.toThrow();
		expect(agent.getSources(SourceType).size).toBe(1);
		expect(agent.get(Property)).toBe(1);

		agent.getSources(SourceType).forEach((source) => source.destroy());
		expect(agent.addSource(SourceType, 2)).toBeDefined();
		expect(agent.get(Property)).toBe(2);
	});

	it("reports a Descriptor property observer failure after admission", () => {
		const Property = defineNumberProperty({
			name: "ThrowingAdmissionFlushDescriptorProperty",
			defaultValue: 0,
		});
		const OutputType = defineSourceType<number>({
			name: "ThrowingAdmissionFlushDescriptorOutput",
			priority: 100,
			contribute: (value) => [Property.add(value)],
		});
		const DescriptorType = defineDescriptorType<number, number>({
			name: "ThrowingAdmissionFlushDescriptor",
			source: OutputType,
			duplication: { policy: "ignore" },
		});
		const agent = new AgentState(undefined, { reporter: testReporter });
		agent.registerDescriptorHandler(DescriptorType, (ctx, data) => {
			const source = ctx.addSource(data)!;
			return {
				source,
				update: (value) => source.set(value),
				destroy: () => source.destroy(),
			};
		});
		agent.onPropertyChanged(Property, (value) => {
			if (value === 1) throw new Error("admission flush failed");
		});

		expect(() => agent.addDescriptor(DescriptorType, 1)).not.toThrow();
		expect(agent.getDescriptors(DescriptorType).size).toBe(1);
		expect(agent.getSources(OutputType).size).toBe(1);
		expect(agent.get(Property)).toBe(1);

		agent.getDescriptors(DescriptorType).forEach((descriptor) => descriptor.destroy());
		expect(agent.addDescriptor(DescriptorType, 2)).toBeDefined();
		expect(agent.get(Property)).toBe(2);
	});
});
