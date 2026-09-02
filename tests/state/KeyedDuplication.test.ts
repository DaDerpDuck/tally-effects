import { describe, expect, it } from "vitest";
import { AgentState, defineDescriptorType, defineSourceType } from "../src/index.js";

describe("keyed source duplication", () => {
	it("isolates conflicts by key and keeps null distinct from an unspecified key", () => {
		const SourceType = defineSourceType<number>({
			name: "KeyIsolationSource",
			priority: 100,
			duplication: { policy: "ignore" },
			contribute: () => [],
		});
		const agent = new AgentState(undefined);

		const firstA = agent.addSource(SourceType, 1, { key: "a" })!;
		const firstB = agent.addSource(SourceType, 2, { key: "b" })!;
		const firstUnkeyed = agent.addSource(SourceType, 3)!;
		const firstNull = agent.addSource(SourceType, 4, { key: null })!;

		expect(agent.addSource(SourceType, 10, { key: "a" })).toBeUndefined();
		expect(agent.addSource(SourceType, 20, { key: "b" })).toBeUndefined();
		expect(agent.addSource(SourceType, 30)).toBeUndefined();
		expect(agent.addSource(SourceType, 40, { key: null })).toBeUndefined();
		expect(agent.getSources(SourceType)).toEqual(
			new Set([firstA, firstB, firstUnkeyed, firstNull])
		);
	});

	it("unregisters only the destroyed candidate's key bucket", () => {
		const SourceType = defineSourceType<number>({
			name: "KeyCleanupSource",
			priority: 100,
			duplication: { policy: "ignore" },
			contribute: () => [],
		});
		const agent = new AgentState(undefined);
		const firstA = agent.addSource(SourceType, 1, { key: "a" })!;
		const firstB = agent.addSource(SourceType, 2, { key: "b" })!;

		firstA.destroy();
		const replacementA = agent.addSource(SourceType, 3, { key: "a" })!;

		expect(replacementA).toBeDefined();
		expect(agent.addSource(SourceType, 4, { key: "b" })).toBeUndefined();
		expect(agent.getSources(SourceType)).toEqual(new Set([firstB, replacementA]));
	});

	it("replaces only candidates with the same key", () => {
		const SourceType = defineSourceType<number>({
			name: "KeyReplacementSource",
			priority: 100,
			duplication: { policy: "replace" },
			contribute: () => [],
		});
		const agent = new AgentState(undefined);
		const firstA = agent.addSource(SourceType, 1, { key: "a" })!;
		const firstB = agent.addSource(SourceType, 2, { key: "b" })!;

		const replacementA = agent.addSource(SourceType, 3, { key: "a" })!;

		expect(agent.getSources(SourceType)).toEqual(new Set([firstB, replacementA]));
		expect(agent.getSources(SourceType)).not.toContain(firstA);
	});
});

describe("keyed descriptor duplication", () => {
	it("isolates Descriptor conflicts by key", () => {
		const OutputType = defineSourceType<number>({
			name: "KeyedDescriptorOutput",
			priority: 100,
			contribute: () => [],
		});
		const DescriptorType = defineDescriptorType<number, number>({
			name: "KeyedDescriptor",
			source: OutputType,
			duplication: { policy: "ignore" },
		});
		const agent = new AgentState(undefined);
		agent.registerDescriptorHandler(DescriptorType, (ctx, data) => {
			const source = ctx.addSource(data)!;
			return {
				source,
				update(value) {
					source.set(value);
				},
				destroy() {
					source.destroy();
				},
			};
		});

		const firstA = agent.addDescriptor(DescriptorType, 1, { key: "a" })!;
		const firstB = agent.addDescriptor(DescriptorType, 2, { key: "b" })!;

		expect(agent.addDescriptor(DescriptorType, 3, { key: "a" })).toBeUndefined();
		expect(agent.getDescriptors(DescriptorType)).toEqual(new Set([firstA, firstB]));
		expect(agent.getSources(OutputType).size).toBe(2);
	});

	it("forwards handler-provided keys to a Descriptor's Source", () => {
		interface DescriptorData {
			readonly sourceKey: string;
			readonly value: number;
		}

		const OutputType = defineSourceType<number>({
			name: "DescriptorKeyForwardingOutput",
			priority: 100,
			duplication: { policy: "ignore" },
			contribute: () => [],
		});
		const DescriptorType = defineDescriptorType<DescriptorData, number>({
			name: "DescriptorKeyForwardingDescriptor",
			source: OutputType,
		});
		const agent = new AgentState(undefined);
		agent.registerDescriptorHandler(DescriptorType, (ctx, data) => {
			const source = ctx.addSource(data.value, { key: data.sourceKey });
			if (!source) return undefined;
			return {
				source,
				update(value) {
					source.set(value.value);
				},
				destroy() {
					source.destroy();
				},
			};
		});

		const first = agent.addDescriptor(DescriptorType, { sourceKey: "a", value: 1 });
		const second = agent.addDescriptor(DescriptorType, { sourceKey: "b", value: 2 });
		const duplicate = agent.addDescriptor(DescriptorType, { sourceKey: "a", value: 3 });

		expect(first).toBeDefined();
		expect(second).toBeDefined();
		expect(duplicate).toBeUndefined();
		expect(agent.getSources(OutputType).size).toBe(2);
	});
});
