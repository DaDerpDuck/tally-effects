import { describe, expect, it, vi } from "vitest";
import {
	AgentState,
	defineDescriptorType,
	defineNumberProperty,
	defineSourceType,
	type Descriptor,
	testReporter,
} from "../src/index.js";

describe("Descriptor admission and teardown reentrancy", () => {
	it("finishes Descriptor teardown when destroy callbacks throw", () => {
		const Property = defineNumberProperty({
			name: "ThrowingDescriptorDestroyCallbackProperty",
			defaultValue: 0,
		});
		const OutputType = defineSourceType<number>({
			name: "ThrowingDescriptorDestroyCallbackOutput",
			priority: 100,
			contribute: (value) => [Property.add(value)],
		});
		const DescriptorType = defineDescriptorType<number, number>({
			name: "ThrowingDescriptorDestroyCallback",
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
		const laterDestroyCallback = vi.fn();
		const removed = vi.fn();
		descriptor.onDestroy(() => {
			throw new Error("descriptor destroy callback failed");
		});
		descriptor.onDestroy(laterDestroyCallback);
		agent.onDescriptorRemoved(removed);

		expect(() => descriptor.destroy()).not.toThrow();

		expect(laterDestroyCallback).toHaveBeenCalledWith(descriptor);
		expect(removed).toHaveBeenCalledWith(descriptor);
		expect(agent.getDescriptors(DescriptorType)).toEqual(new Set());
		expect(agent.getSources(OutputType)).toEqual(new Set());
		expect(agent.get(Property)).toBe(0);
		expect(agent.addDescriptor(DescriptorType, 2)).toBeDefined();
	});

	it("notifies Descriptor removal when an added observer destroys the Descriptor", () => {
		const OutputType = defineSourceType<number>({
			name: "AddedObserverRemovedDescriptorOutput",
			priority: 100,
			contribute: () => [],
		});
		const DescriptorType = defineDescriptorType<number, number>({
			name: "AddedObserverRemovedDescriptor",
			source: OutputType,
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
		const events = new Array<string>();
		agent.onDescriptorAdded((descriptor) => {
			events.push("added");
			descriptor.destroy();
		});
		agent.onDescriptorRemoved(() => events.push("removed"));

		agent.addDescriptor(DescriptorType, 1);

		expect(events).toEqual(["added", "removed"]);
	});

	it("reports a Descriptor added observer failure without rolling back", () => {
		const OutputType = defineSourceType<number>({
			name: "ThrowingAddedDescriptorOutput",
			priority: 100,
			contribute: () => [],
		});
		const DescriptorType = defineDescriptorType<number, number>({
			name: "ThrowingAddedDescriptor",
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
		let shouldThrow = true;
		agent.onDescriptorAdded(() => {
			if (shouldThrow) throw new Error("added callback failed");
		});

		expect(() => agent.addDescriptor(DescriptorType, 1)).not.toThrow();
		expect(agent.getDescriptors(DescriptorType).size).toBe(1);
		expect(agent.getSources(OutputType).size).toBe(1);

		shouldThrow = false;
		agent.getDescriptors(DescriptorType).forEach((descriptor) => descriptor.destroy());
		expect(agent.addDescriptor(DescriptorType, 2)).toBeDefined();
	});

	it("makes a Descriptor terminal when binding cleanup throws", () => {
		const OutputType = defineSourceType<number>({
			name: "ThrowingRollbackDescriptorOutput",
			priority: 100,
			contribute: () => [],
		});
		const DescriptorType = defineDescriptorType<number, number>({
			name: "ThrowingRollbackDescriptor",
			source: OutputType,
		});
		const agent = new AgentState<undefined>(undefined, { reporter: testReporter });
		let captured: Descriptor<number, number> | undefined;
		agent.registerDescriptorHandler(DescriptorType, (ctx, data) => {
			const source = ctx.addSource(data)!;
			return {
				source,
				update: (value) => source.set(value),
				destroy: () => {
					throw new Error("binding cleanup failed");
				},
			};
		});
		agent.onDescriptorAdded((descriptor) => {
			captured = descriptor as Descriptor<number, number>;
			throw new Error("added callback failed");
		});

		expect(() => agent.addDescriptor(DescriptorType, 1)).not.toThrow();
		expect(agent.getDescriptors(DescriptorType).size).toBe(1);
		expect(agent.getSources(OutputType).size).toBe(1);

		expect(() => captured!.destroy()).not.toThrow();
		expect(agent.getDescriptors(DescriptorType)).toEqual(new Set());
		expect(agent.getSources(OutputType)).toEqual(new Set());
		expect(() => captured!.set(2)).toThrow("Descriptor has been destroyed");
	});

	it("finishes Descriptor removal notifications and aggregates binding cleanup failures", () => {
		const OutputType = defineSourceType<number>({
			name: "AggregateDescriptorCleanupOutput",
			priority: 100,
			contribute: () => [],
		});
		const DescriptorType = defineDescriptorType<number, number>({
			name: "AggregateDescriptorCleanup",
			source: OutputType,
		});
		const agent = new AgentState<undefined>(undefined, { reporter: testReporter });
		agent.registerDescriptorHandler(DescriptorType, (ctx, data) => {
			const source = ctx.addSource(data)!;
			source.onDestroy(() => {
				throw new Error("derived source cleanup failed");
			});
			return {
				source,
				update: (value) => source.set(value),
				destroy: () => {
					throw new Error("binding cleanup failed");
				},
			};
		});
		const descriptor = agent.addDescriptor(DescriptorType, 1)!;
		const removed = vi.fn();
		agent.onDescriptorRemoved(removed);

		expect(() => descriptor.destroy()).not.toThrow();
		expect(removed).toHaveBeenCalledWith(descriptor);
		expect(agent.getDescriptors(DescriptorType)).toEqual(new Set());
		expect(agent.getSources(OutputType)).toEqual(new Set());
	});
});
