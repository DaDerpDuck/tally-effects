import { describe, expect, it, vi } from "vitest";
import { createResolutionFailureFixture, Poison, PoisonSource } from "../fixtures/AgentState.js";
import {
	AgentState,
	createTestReporter,
	defineDescriptorType,
	defineNumberProperty,
	defineSourceType,
	testReporter,
} from "../src/index.js";

describe("agent state", () => {
	it("throws when mutating a destroyed source", () => {
		const agent = new AgentState(undefined, { reporter: testReporter });
		const source = agent.addSource(PoisonSource, { intensity: 5 })!;

		source.destroy();

		expect(() => source.set({ intensity: 10 })).toThrow();
		expect(source.get()).toEqual({ intensity: 5 });
	});
	it("allows inert source callbacks after destruction", () => {
		const agent = new AgentState(undefined, { reporter: testReporter });
		const source = agent.addSource(PoisonSource, { intensity: 5 })!;
		source.destroy();

		const updated = vi.fn();
		const destroyed = vi.fn();
		const disconnectUpdate = source.onUpdate(updated);
		const disconnectDestroy = source.onDestroy(destroyed);

		expect(() => source.destroy()).not.toThrow();
		expect(updated).not.toHaveBeenCalled();
		expect(destroyed).not.toHaveBeenCalled();
		expect(() => disconnectUpdate()).not.toThrow();
		expect(() => disconnectDestroy()).not.toThrow();
	});
	it("rejects AgentState mutations after destruction while keeping reads and callbacks safe", () => {
		const agent = new AgentState(undefined, { reporter: testReporter });
		agent.addSource(PoisonSource, { intensity: 5 });
		agent.destroy();

		expect(agent.get(Poison)).toBe(0);
		expect(agent.getSources()).toEqual(new Set());
		expect(agent.hasSource(PoisonSource)).toBe(false);

		const added = vi.fn();
		const changed = vi.fn();
		const destroyed = vi.fn();
		const disconnectAdded = agent.onSourceAdded(added);
		const disconnectChanged = agent.onPropertyChanged(Poison, changed);
		const disconnectDestroyed = agent.onDestroy(destroyed);

		expect(() => agent.addSource(PoisonSource, { intensity: 10 })).toThrow();
		expect(() => agent.destroy()).not.toThrow();
		expect(added).not.toHaveBeenCalled();
		expect(changed).not.toHaveBeenCalled();
		expect(destroyed).not.toHaveBeenCalled();
		expect(() => disconnectAdded()).not.toThrow();
		expect(() => disconnectChanged()).not.toThrow();
		expect(() => disconnectDestroyed()).not.toThrow();
	});
	it("disconnects source observation", () => {
		const agent = new AgentState(undefined, { reporter: testReporter });
		const callback = vi.fn();

		const disconnect = agent.onPropertyChanged(Poison, callback);
		disconnect();
		agent.addSource(PoisonSource, { intensity: 5 });

		expect(callback).toHaveBeenCalledTimes(0);
	});
	it("checks has source", () => {
		const agent = new AgentState(undefined, { reporter: testReporter });
		expect(agent.hasSource(PoisonSource)).toBe(false);

		const source = agent.addSource(PoisonSource, { intensity: 100 })!;
		expect(agent.hasSource(PoisonSource)).toBe(true);

		source.destroy();
		expect(agent.hasSource(PoisonSource)).toBe(false);
	});
	it("assigns unique monotonic source ids within an agent", () => {
		const agent = new AgentState(undefined, { reporter: testReporter });
		const SourceType = defineSourceType<undefined>({
			name: "IdentifiedSource",
			priority: 100,
			contribute: () => [],
		});

		const source1 = agent.addSource(SourceType)!;
		const source2 = agent.addSource(SourceType)!;
		const source3 = agent.addSource(SourceType)!;

		expect([source1.id, source2.id, source3.id]).toEqual([0, 1, 2]);
	});
	it("removes destroyed sources from unfiltered getSources", () => {
		const agent = new AgentState(undefined, { reporter: testReporter });
		const SourceTypeA = defineSourceType<undefined>({
			name: "SourceA",
			priority: 100,
			contribute: () => [],
		});
		const SourceTypeB = defineSourceType<undefined>({
			name: "SourceB",
			priority: 100,
			contribute: () => [],
		});

		const source1 = agent.addSource(SourceTypeA)!;
		const source2 = agent.addSource(SourceTypeB)!;
		const source3 = agent.addSource(SourceTypeA)!;

		expect(agent.getSources()).toEqual(new Set([source1, source2, source3]));

		source2.destroy();
		expect(agent.getSources()).toEqual(new Set([source1, source3]));
	});
	it("destroyAllSources removes all source state and restores defaults", () => {
		const Property = defineNumberProperty({ name: "DestroyAllProperty", defaultValue: 10 });
		const SourceTypeA = defineSourceType<number>({
			name: "DestroyAllSourceA",
			priority: 0,
			contribute: (value) => [Property.add(value)],
		});
		const SourceTypeB = defineSourceType<number>({
			name: "DestroyAllSourceB",
			priority: 100,
			contribute: (value) => [Property.multiply(value)],
		});
		const agent = new AgentState(undefined, { reporter: testReporter });

		agent.addSource(SourceTypeA, 5);
		agent.addSource(SourceTypeB, 2);
		expect(agent.get(Property)).toBe(30);

		agent.destroyAllSources();

		expect(agent.getSources()).toEqual(new Set());
		expect(agent.hasSource(SourceTypeA)).toBe(false);
		expect(agent.hasSource(SourceTypeB)).toBe(false);
		expect(agent.get(Property)).toBe(10);
	});
	it("settles all Sources and Descriptors when AgentState destruction encounters errors", () => {
		const FirstSourceType = defineSourceType<undefined>({
			name: "AgentDestroyThrowingFirstSource",
			priority: 100,
			contribute: () => [],
		});
		const SecondSourceType = defineSourceType<undefined>({
			name: "AgentDestroySecondSource",
			priority: 100,
			contribute: () => [],
		});
		const DescriptorOutput = defineSourceType<undefined>({
			name: "AgentDestroyDescriptorOutput",
			priority: 100,
			contribute: () => [],
		});
		const DescriptorType = defineDescriptorType<undefined, undefined>({
			name: "AgentDestroyDescriptor",
			source: DescriptorOutput,
		});
		const agent = new AgentState(undefined, { reporter: testReporter });
		agent.registerDescriptorHandler(DescriptorType, (ctx) => {
			const source = ctx.addSource(undefined)!;
			return {
				source,
				update: () => {},
				destroy: () => source.destroy(),
			};
		});
		const first = agent.addSource(FirstSourceType)!;
		const second = agent.addSource(SecondSourceType)!;
		const descriptor = agent.addDescriptor(DescriptorType, undefined)!;
		first.onDestroy(() => {
			throw new Error("first source destroy failed");
		});

		expect(() => agent.destroy()).not.toThrow();
		expect(agent.getSources()).toEqual(new Set());
		expect(agent.getDescriptors()).toEqual(new Set());
		expect(() => second.set(undefined)).toThrow("Source has been destroyed");
		expect(() => descriptor.set(undefined)).toThrow("Descriptor has been destroyed");
	});
	it("destroys Descriptors after a Source teardown resolution failure", () => {
		const { sourceType, throwOnResolve } = createResolutionFailureFixture(
			"AgentDestroyResolutionFailure"
		);
		const DescriptorOutput = defineSourceType<undefined>({
			name: "AgentDestroyResolutionFailureDescriptorOutput",
			priority: 100,
			contribute: () => [],
		});
		const DescriptorType = defineDescriptorType<undefined, undefined>({
			name: "AgentDestroyResolutionFailureDescriptor",
			source: DescriptorOutput,
		});
		const { reporter, reports } = createTestReporter();
		const agent = new AgentState(undefined, { reporter });
		agent.registerDescriptorHandler(DescriptorType, (context) => {
			const source = context.addSource(undefined)!;
			return { source, update: () => {}, destroy: () => source.destroy() };
		});
		agent.addSource(sourceType, 1);
		agent.addDescriptor(DescriptorType, undefined);

		throwOnResolve();
		expect(() => agent.destroy()).not.toThrow();
		expect(reports).toEqual([
			expect.objectContaining({
				error: new Error("AgentDestroyResolutionFailure resolution failed"),
				code: "property-resolution-failed",
				operation: "resolve",
				subject: {
					kind: "property",
					name: "AgentDestroyResolutionFailureProperty",
				},
			}),
		]);
		expect(agent.getDescriptors(DescriptorType)).toEqual(new Set());
		expect(agent.getSources(DescriptorOutput)).toEqual(new Set());
	});
});
