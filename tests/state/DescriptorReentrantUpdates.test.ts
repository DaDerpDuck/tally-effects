import { describe, expect, it, vi } from "vitest";
import { Value } from "../fixtures/Descriptor.js";
import {
	AgentState,
	defineDescriptorType,
	defineSourceType,
	type Descriptor,
	testReporter,
} from "../src/index.js";

describe("descriptor lifecycle", () => {
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
	it("keeps descriptor state aligned when an update observer reenters", () => {
		const Output = defineSourceType<number>({
			name: "ObserverReentrantDescriptorOutput",
			priority: 100,
			contribute: (value) => [Value.add(value)],
		});
		const ReentrantDescriptor = defineDescriptorType<number, number>({
			name: "ObserverReentrantDescriptor",
			source: Output,
		});
		const agent = new AgentState<undefined>(undefined, { reporter: testReporter });
		agent.registerDescriptorHandler(ReentrantDescriptor, (context, value) => {
			const source = context.addSource(value)!;
			return {
				source,
				update: (next) => source.set(next),
				destroy: () => source.destroy(),
			};
		});
		const descriptor = agent.addDescriptor(ReentrantDescriptor, 1)!;
		const observedValues: number[] = [];
		const managerValues: number[] = [];
		descriptor.onUpdate((self) => {
			observedValues.push(self.get());
			expect(self.getSource().get()).toBe(self.get());
			if (self.get() === 2) self.set(3);
		});
		agent.onDescriptorUpdated(() => managerValues.push(descriptor.get()));

		descriptor.set(2);

		expect(descriptor.get()).toBe(3);
		expect(descriptor.getSource().get()).toBe(3);
		expect(agent.get(Value)).toBe(3);
		expect(observedValues).toEqual([2, 3]);
		expect(managerValues).toEqual([3]);
	});
	it("processes an AgentState descriptor observer update after the active event", () => {
		const Output = defineSourceType<number>({
			name: "ManagerObserverReentrantDescriptorOutput",
			priority: 100,
			contribute: (value) => [Value.add(value)],
		});
		const ReentrantDescriptor = defineDescriptorType<number, number>({
			name: "ManagerObserverReentrantDescriptor",
			source: Output,
		});
		const agent = new AgentState<undefined>(undefined, { reporter: testReporter });
		agent.registerDescriptorHandler(ReentrantDescriptor, (context, value) => {
			const source = context.addSource(value)!;
			return {
				source,
				update: (next) => source.set(next),
				destroy: () => source.destroy(),
			};
		});
		const descriptor = agent.addDescriptor(ReentrantDescriptor, 1)!;
		const observedValues: number[] = [];
		agent.onDescriptorUpdated(() => {
			observedValues.push(descriptor.get());
			expect(descriptor.getSource().get()).toBe(descriptor.get());
			if (descriptor.get() === 2) descriptor.set(3);
		});

		descriptor.set(2);

		expect(descriptor.get()).toBe(3);
		expect(descriptor.getSource().get()).toBe(3);
		expect(agent.get(Value)).toBe(3);
		expect(observedValues).toEqual([2, 3]);
	});
});
