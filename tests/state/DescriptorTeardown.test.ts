import { describe, expect, it, vi } from "vitest";
import {
	createAgentFixture,
	createResolutionFailureSourceType,
	DescriptorSource,
	registerHandler,
	Value,
	ValueDescriptor,
} from "../fixtures/Descriptor.js";
import {
	AgentState,
	defineDescriptorType,
	defineSourceType,
	type TallyReporter,
	testReporter,
} from "../src/index.js";

describe("descriptor lifecycle", () => {
	it("destroys its binding and removes itself from the agent", () => {
		const { agent, bindingDestroyed } = createAgentFixture();
		const descriptor = agent.addDescriptor(ValueDescriptor, { value: 5 })!;
		const destroyed = vi.fn();
		descriptor.onDestroy(destroyed);

		descriptor.destroy();

		expect(bindingDestroyed).toHaveBeenCalledTimes(1);
		expect(destroyed).toHaveBeenCalledTimes(1);
		expect(destroyed).toHaveBeenCalledWith(descriptor);
		expect(agent.getDescriptors(ValueDescriptor).size).toBe(0);
		expect(agent.getSources(DescriptorSource).size).toBe(0);
		expect(agent.get(Value)).toBe(0);
	});
	it("destroys a descriptor binding only once", () => {
		const { agent, bindingDestroyed } = createAgentFixture();
		const descriptor = agent.addDescriptor(ValueDescriptor, { value: 5 })!;

		descriptor.destroy();
		descriptor.destroy();

		expect(bindingDestroyed).toHaveBeenCalledTimes(1);
		expect(agent.getDescriptors(ValueDescriptor).size).toBe(0);
	});
	it("keeps its bound source readable after destruction", () => {
		const { agent } = createAgentFixture();
		const descriptor = agent.addDescriptor(ValueDescriptor, { value: 5 })!;
		const source = descriptor.getSource();

		descriptor.destroy();

		expect(descriptor.getSource()).toBe(source);
	});
	it("destroys derived sources added reentrantly while its binding is torn down", () => {
		const Output = defineSourceType<number>({
			name: "ReentrantBindingDestroyOutput",
			priority: 100,
			contribute: () => [],
		});
		const ReentrantDescriptor = defineDescriptorType<number, number>({
			name: "ReentrantBindingDestroyDescriptor",
			source: Output,
		});
		const agent = new AgentState<undefined>(undefined, { reporter: testReporter });
		agent.registerDescriptorHandler(ReentrantDescriptor, (ctx, data) => {
			const source = ctx.addSource(data)!;
			return {
				source,
				update: (value) => source.set(value),
				destroy: () => {
					expect(descriptor.getSource()).toBe(source);
					ctx.addSource(data + 1);
					source.destroy();
				},
			};
		});

		const descriptor = agent.addDescriptor(ReentrantDescriptor, 1)!;
		descriptor.destroy();

		expect(agent.getDescriptors(ReentrantDescriptor)).toEqual(new Set());
		expect(agent.getSources(Output)).toEqual(new Set());
	});
	it("continues draining derived Sources after one teardown fails and reenters", () => {
		const Output = defineSourceType<number>({
			name: "ThrowingReentrantBindingDestroyOutput",
			priority: 100,
			contribute: () => [],
		});
		const ThrowingDescriptor = defineDescriptorType<number, number>({
			name: "ThrowingReentrantBindingDestroyDescriptor",
			source: Output,
		});
		const agent = new AgentState<undefined>(undefined, { reporter: testReporter });
		agent.registerDescriptorHandler(ThrowingDescriptor, (ctx, data) => {
			const first = ctx.addSource(data)!;
			const second = ctx.addSource(data + 1)!;
			first.onDestroy(() => {
				ctx.addSource(data + 2);
				throw new Error("first derived source destroy failed");
			});
			return {
				source: first,
				update: (value) => first.set(value),
				destroy: () => {
					// DescriptorRuntime owns the derived Sources and must drain them all.
				},
			};
		});
		const descriptor = agent.addDescriptor(ThrowingDescriptor, 1)!;

		expect(() => descriptor.destroy()).not.toThrow();
		expect(agent.getDescriptors(ThrowingDescriptor)).toEqual(new Set());
		expect(agent.getSources(Output)).toEqual(new Set());
	});
	it("drains every derived Source when one Source teardown resolution fails", () => {
		const { sourceType, throwOnResolve } = createResolutionFailureSourceType(
			"DescriptorDerivedSourceCleanup"
		);
		const DescriptorType = defineDescriptorType<number, number>({
			name: "DescriptorDerivedSourceCleanupDescriptor",
			source: sourceType,
		});
		const agent = new AgentState<undefined>(undefined, { reporter: testReporter });
		agent.registerDescriptorHandler(DescriptorType, (context) => {
			const first = context.addSource(1)!;
			context.addSource(2);
			return { source: first, update: (value) => first.set(value), destroy: () => {} };
		});
		const descriptor = agent.addDescriptor(DescriptorType, 1)!;

		throwOnResolve();
		expect(() => descriptor.destroy()).not.toThrow();

		expect(agent.getDescriptors(DescriptorType)).toEqual(new Set());
		expect(agent.getSources(sourceType)).toEqual(new Set());
	});
	it("drains every derived Source when reporting binding cleanup failure throws", () => {
		const reporter: TallyReporter = {
			report() {
				throw new Error("reporter failed");
			},
		};
		const Output = defineSourceType<number>({
			name: "ReporterFailureDescriptorOutput",
			priority: 100,
			contribute: () => [],
		});
		const DescriptorType = defineDescriptorType<number, number>({
			name: "ReporterFailureDescriptor",
			source: Output,
		});
		const agent = new AgentState<undefined>(undefined, { reporter });
		agent.registerDescriptorHandler(DescriptorType, (context) => {
			const first = context.addSource(1)!;
			context.addSource(2);
			return {
				source: first,
				update: (value) => first.set(value),
				destroy() {
					throw new Error("binding cleanup failed");
				},
			};
		});
		const descriptor = agent.addDescriptor(DescriptorType, 1)!;

		expect(() => descriptor.destroy()).not.toThrow();

		expect(agent.getDescriptors(DescriptorType)).toEqual(new Set());
		expect(agent.getSources(Output)).toEqual(new Set());
	});
	it("throws when mutating a destroyed descriptor", () => {
		const { agent } = createAgentFixture();
		const descriptor = agent.addDescriptor(ValueDescriptor, { value: 5 })!;
		descriptor.destroy();

		expect(() => descriptor.set({ value: 8 })).toThrow();
		expect(descriptor.get()).toEqual({ value: 5 });
	});
	it("allows inert descriptor callbacks after destruction", () => {
		const { agent } = createAgentFixture();
		const descriptor = agent.addDescriptor(ValueDescriptor, { value: 5 })!;
		descriptor.destroy();

		const updated = vi.fn();
		const destroyed = vi.fn();
		const disconnectUpdate = descriptor.onUpdate(updated);
		const disconnectDestroy = descriptor.onDestroy(destroyed);

		expect(() => descriptor.destroy()).not.toThrow();
		expect(updated).not.toHaveBeenCalled();
		expect(destroyed).not.toHaveBeenCalled();
		expect(() => disconnectUpdate()).not.toThrow();
		expect(() => disconnectDestroy()).not.toThrow();
	});
	it("rejects descriptor mutations on a destroyed AgentState while keeping callbacks safe", () => {
		const { agent } = createAgentFixture();
		agent.destroy();

		expect(agent.getDescriptors()).toEqual(new Set());
		const added = vi.fn();
		const disconnectAdded = agent.onDescriptorAdded(added);

		expect(() => agent.addDescriptor(ValueDescriptor, { value: 5 })).toThrow();
		expect(() => registerHandler(agent)).toThrow();
		expect(added).not.toHaveBeenCalled();
		expect(() => disconnectAdded()).not.toThrow();
	});
});
