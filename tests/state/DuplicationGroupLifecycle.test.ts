import { describe, expect, it, vi } from "vitest";
import {
	AgentState,
	defineDescriptorType,
	defineSourceType,
	DuplicationGroup,
	testReporter,
} from "../src/index.js";

describe("heterogeneous DuplicationGroup lifecycle", () => {
	it("can evict Sources and Descriptors through the shared candidate contract", () => {
		const group = new DuplicationGroup({
			policy: "replace",
			maxStack: 1,
			selector: "newest",
		});
		const GroupedSourceType = defineSourceType<number>({
			name: "CrossKindGroupedSource",
			priority: 100,
			duplication: group.member({ rank: (value) => value }),
			contribute: () => [],
		});
		const OutputType = defineSourceType<number>({
			name: "CrossKindDescriptorOutput",
			priority: 100,
			contribute: () => [],
		});
		const DescriptorType = defineDescriptorType<number, number>({
			name: "CrossKindGroupedDescriptor",
			source: OutputType,
			duplication: group.member({ rank: (value) => value }),
		});
		const agent = new AgentState(undefined, { reporter: testReporter });
		const bindingDestroyed = vi.fn();
		agent.registerDescriptorHandler(DescriptorType, (ctx, data) => {
			const source = ctx.addSource(data)!;
			return {
				source,
				update(value) {
					source.set(value);
				},
				destroy() {
					bindingDestroyed();
					source.destroy();
				},
			};
		});
		const firstSource = agent.addSource(GroupedSourceType, 1, { key: "shared" })!;

		const descriptor = agent.addDescriptor(DescriptorType, 2, { key: "shared" })!;
		expect(agent.getSources(GroupedSourceType)).not.toContain(firstSource);
		expect(agent.getDescriptors(DescriptorType)).toEqual(new Set([descriptor]));

		const replacementSource = agent.addSource(GroupedSourceType, 3, { key: "shared" })!;
		expect(bindingDestroyed).toHaveBeenCalledOnce();
		expect(agent.getDescriptors(DescriptorType)).not.toContain(descriptor);
		expect(agent.getSources(GroupedSourceType)).toEqual(new Set([replacementSource]));
		expect(agent.getSources(OutputType).size).toBe(0);
	});
});
