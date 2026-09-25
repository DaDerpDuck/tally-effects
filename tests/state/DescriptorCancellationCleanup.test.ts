import { describe, expect, it, vi } from "vitest";
import {
	AgentState,
	createTestReporter,
	defineDescriptorType,
	defineSourceType,
	DuplicationGroup,
	testReporter,
} from "../src/index.js";

describe("cancelled Descriptor binding cleanup", () => {
	it("destroys a binding returned after reentrant replacement cancels admission", () => {
		const Output = defineSourceType<number>({
			name: "CancelledBindingOutput",
			priority: 100,
			contribute: () => [],
		});
		const group = new DuplicationGroup({
			policy: "replace",
			maxStack: 1,
			selector: "oldest",
		});
		const DescriptorType = defineDescriptorType<number, number>({
			name: "CancelledBindingDescriptor",
			source: Output,
			duplication: group.member(),
		});
		const agent = new AgentState(undefined, { reporter: testReporter });
		const destroyCancelledBinding = vi.fn();
		agent.registerDescriptorHandler(DescriptorType, (context, data) => {
			if (data === 1) agent.addDescriptor(DescriptorType, 2);
			const source = context.addSource(data)!;
			return {
				source,
				update: (value) => source.set(value),
				destroy: () => {
					if (data === 1) destroyCancelledBinding();
					source.destroy();
				},
			};
		});

		expect(agent.addDescriptor(DescriptorType, 1)).toBeUndefined();
		expect(destroyCancelledBinding).toHaveBeenCalledOnce();
		expect(
			[...agent.getDescriptors(DescriptorType)].map((descriptor) => descriptor.get())
		).toEqual([2]);
		expect([...agent.getSources(Output)].map((source) => source.get())).toEqual([2]);
	});

	it("reports a cancelled binding cleanup failure and still removes derived Sources", () => {
		const Output = defineSourceType<number>({
			name: "ThrowingCancelledBindingOutput",
			priority: 100,
			contribute: () => [],
		});
		const group = new DuplicationGroup({
			policy: "replace",
			maxStack: 1,
			selector: "oldest",
		});
		const DescriptorType = defineDescriptorType<number, number>({
			name: "ThrowingCancelledBindingDescriptor",
			source: Output,
			duplication: group.member(),
		});
		const { reporter, reports } = createTestReporter();
		const agent = new AgentState(undefined, { reporter });
		agent.registerDescriptorHandler(DescriptorType, (context, data) => {
			if (data === 1) agent.addDescriptor(DescriptorType, 2);
			const source = context.addSource(data)!;
			return {
				source,
				update: (value) => source.set(value),
				destroy: () => {
					if (data === 1) throw new Error("binding cleanup failed");
					source.destroy();
				},
			};
		});

		expect(agent.addDescriptor(DescriptorType, 1)).toBeUndefined();
		expect(reports).toEqual([
			expect.objectContaining({
				code: "binding-cleanup-failed",
				error: new Error("binding cleanup failed"),
			}),
		]);
		expect(
			[...agent.getDescriptors(DescriptorType)].map((descriptor) => descriptor.get())
		).toEqual([2]);
		expect([...agent.getSources(Output)].map((source) => source.get())).toEqual([2]);
	});

	it("cleans Sources added after cancellation when the handler then throws", () => {
		const Output = defineSourceType<number>({
			name: "ThrowingCancelledHandlerOutput",
			priority: 100,
			contribute: () => [],
		});
		const group = new DuplicationGroup({
			policy: "replace",
			maxStack: 1,
			selector: "oldest",
		});
		const DescriptorType = defineDescriptorType<number, number>({
			name: "ThrowingCancelledHandlerDescriptor",
			source: Output,
			duplication: group.member(),
		});
		const agent = new AgentState(undefined, { reporter: testReporter });
		agent.registerDescriptorHandler(DescriptorType, (context, data) => {
			if (data === 1) {
				agent.addDescriptor(DescriptorType, 2);
				context.addSource(1);
				throw new Error("handler failed after cancellation");
			}
			const source = context.addSource(data)!;
			return {
				source,
				update: (value) => source.set(value),
				destroy: () => source.destroy(),
			};
		});

		expect(() => agent.addDescriptor(DescriptorType, 1)).toThrow(
			"handler failed after cancellation"
		);
		expect(
			[...agent.getDescriptors(DescriptorType)].map((descriptor) => descriptor.get())
		).toEqual([2]);
		expect([...agent.getSources(Output)].map((source) => source.get())).toEqual([2]);
	});
});
