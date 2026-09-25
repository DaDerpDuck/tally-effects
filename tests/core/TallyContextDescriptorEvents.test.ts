import { describe, expect, it, vi } from "vitest";
import {
	defineDescriptorType,
	defineSourceType,
	TallyContext,
	testReporter,
} from "../src/index.js";

describe("tally context descriptor events", () => {
	it("forwards descriptor additions only to added observers", () => {
		const Output = defineSourceType<number>({
			name: "ContextDescriptorAdditionOutput",
			priority: 100,
			contribute: () => [],
		});
		const DescriptorType = defineDescriptorType<number, number>({
			name: "ContextDescriptorAddition",
			source: Output,
		});
		const tally = new TallyContext<undefined>({ reporter: testReporter });
		tally.registerDescriptorHandler(DescriptorType, (context, value) => {
			const source = context.addSource(value)!;
			return { source, update: (next) => source.set(next), destroy: () => source.destroy() };
		});
		const agent = tally.createAgentState(undefined);
		const added = vi.fn();
		const removed = vi.fn();
		tally.onDescriptorAdded(added);
		tally.onDescriptorRemoved(removed);

		const descriptor = agent.addDescriptor(DescriptorType, 1)!;

		expect(added).toHaveBeenCalledExactlyOnceWith(agent, descriptor);
		expect(removed).not.toHaveBeenCalled();
	});
	it("stops forwarding descriptor events after destruction", () => {
		const SourceType = defineSourceType<number>({
			name: "AfterDestroyDescriptorSource",
			priority: 100,
			contribute: () => [],
		});
		const DescriptorType = defineDescriptorType<number, number>({
			name: "AfterDestroyDescriptor",
			source: SourceType,
		});
		const tally = new TallyContext<undefined>({ reporter: testReporter });
		tally.registerDescriptorHandler(DescriptorType, (ctx, data) => {
			const source = ctx.addSource(data)!;
			return {
				source,
				update(next) {
					source.set(next);
				},
				destroy() {
					source.destroy();
				},
			};
		});
		const agent = tally.createAgentState(undefined);
		const added = vi.fn();
		const updated = vi.fn();
		const removed = vi.fn();
		tally.onDescriptorAdded(added);
		tally.onDescriptorUpdated(updated);
		tally.onDescriptorRemoved(removed);

		tally.destroy();
		const descriptor = agent.addDescriptor(DescriptorType, 1)!;
		descriptor.set(2);
		descriptor.destroy();

		expect(added).not.toHaveBeenCalled();
		expect(updated).not.toHaveBeenCalled();
		expect(removed).not.toHaveBeenCalled();
	});
});
