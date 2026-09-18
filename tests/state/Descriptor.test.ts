import { describe, expect, it, vi } from "vitest";
import {
	AgentState,
	contributeModifier,
	defineDescriptorType,
	defineNumberProperty,
	defineSourceType,
	type Descriptor,
	DescriptorType,
	type Property,
	TallyContext,
	type TallyReporter,
	testReporter,
} from "../src/index.js";

interface DescriptorData {
	value: number;
}

const Value = defineNumberProperty({ name: "DescriptorValue", defaultValue: 0 });

const DescriptorSource = defineSourceType<DescriptorData>({
	name: "DescriptorSource",
	priority: 100,
	contribute: (data) => [Value.add(data.value)],
});

const ValueDescriptor = defineDescriptorType<DescriptorData, DescriptorData>({
	name: "ValueDescriptor",
	source: DescriptorSource,
	replication: {
		serialize: (data) => data.value,
		deserialize: (value) => {
			if (typeof value !== "number")
				throw new Error("Expected descriptor value to be a number");
			return { value };
		},
	},
});

function registerHandler(
	agent: AgentState<undefined> | TallyContext<undefined>,
	descriptorType: DescriptorType<DescriptorData, DescriptorData> = ValueDescriptor,
	onDestroy = vi.fn()
) {
	agent.registerDescriptorHandler(descriptorType, (ctx, data) => {
		const source = ctx.addSource({ value: data.value })!;

		return {
			source,
			update(data) {
				source.set(data);
			},
			destroy() {
				onDestroy();
				source.destroy();
			},
		};
	});

	return onDestroy;
}

function createAgentFixture() {
	const agent = new AgentState<undefined>(undefined, { reporter: testReporter });
	const bindingDestroyed = registerHandler(agent);
	return { agent, bindingDestroyed };
}

function createResolutionFailureSourceType(name: string) {
	let shouldThrow = false;
	const property: Property<number> = {
		name: `${name}Property`,
		defaultValue: 0,
		valueEquals: Object.is,
		resolve(base, modifiers) {
			if (shouldThrow) throw new Error(`${name} resolution failed`);
			return modifiers.reduce((value, modifier) => value + (modifier.value as number), base);
		},
	};
	const sourceType = defineSourceType<number>({
		name: `${name}Source`,
		priority: 100,
		contribute: (value) => [contributeModifier({ property, operation: "add", value })],
	});

	return {
		sourceType,
		throwOnResolve() {
			shouldThrow = true;
		},
	};
}

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

	it("serializes reentrant descriptor binding updates to the newest data", () => {
		const Output = defineSourceType<number>({
			name: "SerializedDescriptorUpdateOutput",
			priority: 100,
			contribute: (value) => [Value.add(value)],
		});
		const ReentrantDescriptor = defineDescriptorType<number, number>({
			name: "SerializedDescriptorUpdate",
			source: Output,
		});
		const agent = new AgentState<undefined>(undefined, { reporter: testReporter });
		const descriptorRef: { current: Descriptor<number, number> | undefined } = {
			current: undefined,
		};
		const updates = new Array<string>();
		agent.registerDescriptorHandler(ReentrantDescriptor, (ctx, data) => {
			const source = ctx.addSource(data)!;
			return {
				source,
				update(value) {
					updates.push(`start-${value}`);
					if (value === 2) descriptorRef.current!.set(3);
					source.set(value);
					updates.push(`end-${value}`);
				},
				destroy: () => source.destroy(),
			};
		});
		const descriptor = agent.addDescriptor(ReentrantDescriptor, 1)!;
		descriptorRef.current = descriptor;
		const announced = vi.fn();
		descriptor.onUpdate(announced);

		descriptor.set(2);

		expect(updates).toEqual(["start-2", "end-2", "start-3", "end-3"]);
		expect(descriptor.get()).toBe(3);
		expect(descriptor.getSource().get()).toBe(3);
		expect(agent.get(Value)).toBe(3);
		expect(announced).toHaveBeenCalledOnce();
	});

	it("propagates binding update failures without announcing an update", () => {
		const Output = defineSourceType<number>({
			name: "ThrowingBindingUpdateOutput",
			priority: 100,
			contribute: (value) => [Value.add(value)],
		});
		const ThrowingBindingUpdate = defineDescriptorType<number, number>({
			name: "ThrowingBindingUpdate",
			source: Output,
		});
		const agent = new AgentState<undefined>(undefined, { reporter: testReporter });
		agent.registerDescriptorHandler(ThrowingBindingUpdate, (context, value) => {
			const source = context.addSource(value)!;
			return {
				source,
				update() {
					throw new Error("binding update failed");
				},
				destroy: () => source.destroy(),
			};
		});
		const descriptor = agent.addDescriptor(ThrowingBindingUpdate, 1)!;
		const updates = vi.fn();
		descriptor.onUpdate(updates);
		const source = descriptor.getSource();

		expect(() => descriptor.set(2)).toThrow("binding update failed");
		expect(descriptor.get()).toBe(2);
		expect(source.get()).toBe(1);
		expect(agent.get(Value)).toBe(1);
		expect(updates).not.toHaveBeenCalled();
	});

	it("uses Object.is as the default descriptor data equality", () => {
		const { agent } = createAgentFixture();
		const initial = { value: 5 };
		const descriptor = agent.addDescriptor(ValueDescriptor, initial)!;
		const updated = vi.fn();
		descriptor.onUpdate(updated);

		descriptor.set(initial);
		expect(updated).not.toHaveBeenCalled();

		descriptor.set({ value: 5 });
		expect(updated).toHaveBeenCalledTimes(1);
	});

	it("uses custom descriptor data equality to suppress binding updates", () => {
		const EquivalentDescriptor = defineDescriptorType<DescriptorData, DescriptorData>({
			name: "EquivalentDescriptor",
			source: DescriptorSource,
			dataEquals: (a, b) => a.value === b.value,
		});
		const agent = new AgentState<undefined>(undefined, { reporter: testReporter });
		registerHandler(agent, EquivalentDescriptor);
		const descriptor = agent.addDescriptor(EquivalentDescriptor, { value: 5 })!;
		const descriptorUpdated = vi.fn();
		const sourceUpdated = vi.fn();
		descriptor.onUpdate(descriptorUpdated);
		descriptor.getSource().onUpdate(sourceUpdated);

		descriptor.set({ value: 5 });
		expect(descriptorUpdated).not.toHaveBeenCalled();
		expect(sourceUpdated).not.toHaveBeenCalled();

		descriptor.set({ value: 8 });
		expect(descriptorUpdated).toHaveBeenCalledTimes(1);
		expect(sourceUpdated).toHaveBeenCalledTimes(1);
	});

	it("propagates descriptor equality failures without changing descriptor data", () => {
		const ThrowingEqualityDescriptor = defineDescriptorType<number, DescriptorData>({
			name: "ThrowingDescriptorEquality",
			source: DescriptorSource,
			dataEquals() {
				throw new Error("descriptor equality failed");
			},
		});
		const agent = new AgentState<undefined>(undefined, { reporter: testReporter });
		agent.registerDescriptorHandler(ThrowingEqualityDescriptor, (context, value) => {
			const source = context.addSource({ value })!;
			return { source, update: () => {}, destroy: () => source.destroy() };
		});
		const descriptor = agent.addDescriptor(ThrowingEqualityDescriptor, 1)!;

		expect(() => descriptor.set(2)).toThrow("descriptor equality failed");
		expect(descriptor.get()).toBe(1);
	});

	it("disconnects descriptor update observers", () => {
		const { agent } = createAgentFixture();
		const descriptor = agent.addDescriptor(ValueDescriptor, { value: 1 })!;
		const updated = vi.fn();
		const disconnect = descriptor.onUpdate(updated);

		descriptor.set({ value: 2 });
		disconnect();
		disconnect();
		descriptor.set({ value: 3 });

		expect(updated).toHaveBeenCalledTimes(1);
	});

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
