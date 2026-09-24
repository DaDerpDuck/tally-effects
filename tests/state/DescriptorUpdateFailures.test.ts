import { describe, expect, it, vi } from "vitest";
import {
	type DescriptorData,
	DescriptorSource,
	Value,
	ValueDescriptor,
	createAgentFixture,
	registerHandler,
} from "../fixtures/Descriptor.js";
import { AgentState, defineDescriptorType, defineSourceType, testReporter } from "../src/index.js";

describe("descriptor lifecycle", () => {
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
	it("retries an unchanged descriptor value after its binding update fails", () => {
		const Output = defineSourceType<number>({
			name: "RetryingBindingUpdateOutput",
			priority: 100,
			contribute: (value) => [Value.add(value)],
		});
		const RetryingBindingUpdate = defineDescriptorType<number, number>({
			name: "RetryingBindingUpdate",
			source: Output,
		});
		const agent = new AgentState<undefined>(undefined, { reporter: testReporter });
		let shouldThrow = true;
		agent.registerDescriptorHandler(RetryingBindingUpdate, (context, value) => {
			const source = context.addSource(value)!;
			return {
				source,
				update(next) {
					if (shouldThrow) throw new Error("binding update failed");
					source.set(next);
				},
				destroy: () => source.destroy(),
			};
		});
		const descriptor = agent.addDescriptor(RetryingBindingUpdate, 1)!;
		const updated = vi.fn();
		descriptor.onUpdate(updated);

		expect(() => descriptor.set(2)).toThrow("binding update failed");
		expect(descriptor.get()).toBe(2);
		expect(descriptor.getSource().get()).toBe(1);
		expect(updated).not.toHaveBeenCalled();

		shouldThrow = false;
		descriptor.set(2);

		expect(descriptor.get()).toBe(2);
		expect(descriptor.getSource().get()).toBe(2);
		expect(agent.get(Value)).toBe(2);
		expect(updated).toHaveBeenCalledOnce();
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
});
