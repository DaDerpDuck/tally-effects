import { describe, expect, it, vi } from "vitest";
import {
	AgentState,
	defineDescriptorType,
	defineNumberProperty,
	defineSourceType,
	type Descriptor,
	type Source,
	testReporter,
} from "../src/index.js";

describe("Descriptor admission and teardown reentrancy", () => {
	it("does not retain a Descriptor destroyed during its added notification", () => {
		const OutputType = defineSourceType<number>({
			name: "AddedObserverDestroyedDescriptorOutput",
			priority: 100,
			contribute: () => [],
		});
		const DescriptorType = defineDescriptorType<number, number>({
			name: "AddedObserverDestroyedDescriptor",
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
		const disconnect = agent.onDescriptorAdded((descriptor) => {
			disconnect();
			descriptor.destroy();
		});

		agent.addDescriptor(DescriptorType, 1);

		expect(agent.addDescriptor(DescriptorType, 2)).toBeDefined();
	});

	it("does not announce a Descriptor destroyed by a property observer before its added event", () => {
		const Property = defineNumberProperty({
			name: "PropertyObserverDestroyedPendingDescriptorProperty",
			defaultValue: 0,
		});
		const OutputType = defineSourceType<number>({
			name: "PropertyObserverDestroyedPendingDescriptorOutput",
			priority: 100,
			contribute: (value) => [Property.add(value)],
		});
		const DescriptorType = defineDescriptorType<number, number>({
			name: "PropertyObserverDestroyedPendingDescriptor",
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
		const added = vi.fn();
		agent.onDescriptorAdded(added);
		agent.onPropertyChanged(Property, (value) => {
			if (value !== 1) return;
			for (const descriptor of agent.getDescriptors(DescriptorType)) descriptor.destroy();
		});

		const destroyedDuringAdmission = agent.addDescriptor(DescriptorType, 1);

		expect(destroyedDuringAdmission).toBeUndefined();
		expect(added).not.toHaveBeenCalled();
		expect(agent.getDescriptors(DescriptorType)).toEqual(new Set());
		expect(agent.getSources(OutputType)).toEqual(new Set());
		expect(agent.addDescriptor(DescriptorType, 2)).toBeDefined();
	});

	it("unregisters a Descriptor before its derived Source removal observers reenter", () => {
		const OutputType = defineSourceType<number>({
			name: "DerivedRemovalReplacementOutput",
			priority: 100,
			contribute: () => [],
		});
		const DescriptorType = defineDescriptorType<number, number>({
			name: "DerivedRemovalReplacementDescriptor",
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
		const descriptor = agent.addDescriptor(DescriptorType, 1)!;
		let replacement: Descriptor<number, number> | undefined;
		const disconnect = agent.onSourceRemoved(() => {
			disconnect();
			replacement = agent.addDescriptor(DescriptorType, 2);
		});

		descriptor.destroy();

		expect(replacement).toBeDefined();
		expect(agent.getDescriptors(DescriptorType)).toEqual(new Set([replacement]));
	});

	it("cleans up a Descriptor when its binding destroy callback throws", () => {
		const OutputType = defineSourceType<number>({
			name: "ThrowingDestroyDescriptorOutput",
			priority: 100,
			contribute: () => [],
		});
		const DescriptorType = defineDescriptorType<number, number>({
			name: "ThrowingDestroyDescriptor",
			source: OutputType,
			duplication: { policy: "ignore" },
		});
		const agent = new AgentState(undefined, { reporter: testReporter });
		let shouldThrow = true;
		agent.registerDescriptorHandler(DescriptorType, (ctx, data) => {
			const source = ctx.addSource(data)!;
			return {
				source,
				update: (value) => source.set(value),
				destroy: () => {
					if (shouldThrow) throw new Error("binding destroy failed");
					source.destroy();
				},
			};
		});
		const descriptor = agent.addDescriptor(DescriptorType, 1)!;

		expect(() => descriptor.destroy()).not.toThrow();
		expect(agent.getDescriptors(DescriptorType)).toEqual(new Set());
		expect(agent.getSources(OutputType)).toEqual(new Set());

		shouldThrow = false;
		expect(agent.addDescriptor(DescriptorType, 2)).toBeDefined();
	});

	it("tears down a Descriptor binding before removed observers attempt replacement", () => {
		const OutputType = defineSourceType<number>({
			name: "RemovedDescriptorReplacementOutput",
			priority: 100,
			duplication: { policy: "ignore" },
			contribute: () => [],
		});
		const DescriptorType = defineDescriptorType<number, number>({
			name: "RemovedDescriptorReplacement",
			source: OutputType,
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
		const descriptor = agent.addDescriptor(DescriptorType, 1)!;
		let replacement: Source<number> | undefined;
		agent.onDescriptorRemoved(() => {
			replacement = agent.addSource(OutputType, 2);
		});

		descriptor.destroy();

		expect(replacement).toBeDefined();
		expect(agent.getSources(OutputType)).toEqual(new Set([replacement]));
	});
});
