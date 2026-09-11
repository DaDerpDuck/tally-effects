import { describe, expect, it, vi } from "vitest";
import {
	AgentState,
	defineDescriptorType,
	defineNumberProperty,
	defineSourceType,
	type Descriptor,
	type DuplicatePolicy,
	type Source,
} from "../src/index.js";

function createSourceFixture(duplication?: DuplicatePolicy<Source<number>, number>) {
	const Property = defineNumberProperty({ name: "SourceDuplicationProperty", defaultValue: 0 });
	const SourceType = defineSourceType<number>({
		name: "SourceDuplicationSource",
		priority: 100,
		contribute: (value) => [Property.add(value)],
		...(duplication === undefined ? {} : { duplication }),
	});
	const agent = new AgentState(undefined);

	return { agent, Property, SourceType };
}

function createDescriptorFixture(
	duplication?: DuplicatePolicy<Descriptor<number, number>, number>
) {
	const Property = defineNumberProperty({
		name: "DescriptorDuplicationProperty",
		defaultValue: 0,
	});
	const SourceType = defineSourceType<number>({
		name: "DescriptorDuplicationSource",
		priority: 100,
		contribute: (value) => [Property.add(value)],
	});
	const DescriptorType = defineDescriptorType<number, number>({
		name: "DescriptorDuplicationDescriptor",
		source: SourceType,
		...(duplication === undefined ? {} : { duplication }),
		replication: {
			serialize: (value) => value,
			deserialize: (value) => {
				if (typeof value !== "number") throw new Error("Expected a number");
				return value;
			},
		},
	});
	const agent = new AgentState(undefined);
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

	return { agent, bindingDestroyed, DescriptorType, Property, SourceType };
}

describe("source duplication policies", () => {
	it("allows duplicates by default", () => {
		const { agent, Property, SourceType } = createSourceFixture();

		const first = agent.addSource(SourceType, 1)!;
		const second = agent.addSource(SourceType, 10)!;

		expect(agent.getSources(SourceType)).toEqual(new Set([first, second]));
		expect(agent.get(Property)).toBe(11);
	});

	it("allows duplicates when configured with allow", () => {
		const { agent, Property, SourceType } = createSourceFixture({ policy: "allow" });

		const first = agent.addSource(SourceType, 1)!;
		const second = agent.addSource(SourceType, 10)!;

		expect(agent.getSources(SourceType)).toEqual(new Set([first, second]));
		expect(agent.get(Property)).toBe(11);
	});

	it("ignores duplicates until the existing source is destroyed", () => {
		const { agent, Property, SourceType } = createSourceFixture({ policy: "ignore" });
		const first = agent.addSource(SourceType, 1)!;

		expect(agent.addSource(SourceType, 10)).toBeUndefined();
		expect(agent.getSources(SourceType)).toEqual(new Set([first]));
		expect(agent.get(Property)).toBe(1);

		first.destroy();
		const replacement = agent.addSource(SourceType, 10)!;

		expect(agent.getSources(SourceType)).toEqual(new Set([replacement]));
		expect(agent.get(Property)).toBe(10);
	});

	it("replaces the existing source", () => {
		const { agent, Property, SourceType } = createSourceFixture({ policy: "replace" });
		const first = agent.addSource(SourceType, 1)!;
		const second = agent.addSource(SourceType, 10)!;

		expect(agent.getSources(SourceType)).toEqual(new Set([second]));
		expect(agent.getSources(SourceType)).not.toContain(first);
		expect(agent.get(Property)).toBe(10);
	});

	it("replaces atomically", () => {
		const { agent, Property, SourceType } = createSourceFixture({ policy: "replace" });
		const changed = vi.fn();
		agent.onPropertyChanged(Property, changed);

		agent.addSource(SourceType, 1);
		agent.addSource(SourceType, 10);

		expect(changed).toHaveBeenCalledTimes(2);
		expect(changed).toHaveBeenNthCalledWith(1, 1, 0);
		expect(changed).toHaveBeenNthCalledWith(2, 10, 1);
	});

	it("preserves the stack limit when an eviction callback adds a duplicate", () => {
		const { agent, SourceType } = createSourceFixture({ policy: "replace" });
		const first = agent.addSource(SourceType, 1)!;
		first.onDestroy(() => agent.addSource(SourceType, 2));

		agent.addSource(SourceType, 3);

		expect(agent.getSources(SourceType).size).toBe(1);
	});

	it("reconciles into the existing source", () => {
		const reconcile = vi.fn((existing: Source<number>, incoming: number) =>
			existing.set(incoming)
		);
		const { agent, Property, SourceType } = createSourceFixture({
			policy: "reconcile",
			reconcile,
		});
		const first = agent.addSource(SourceType, 1)!;

		const duplicate = agent.addSource(SourceType, 10);

		expect(duplicate).toBeUndefined();
		expect(reconcile).toHaveBeenCalledOnce();
		expect(reconcile).toHaveBeenCalledWith(first, 10);
		expect(agent.getSources(SourceType)).toEqual(new Set([first]));
		expect(first.get()).toBe(10);
		expect(agent.get(Property)).toBe(10);
	});
});

describe("descriptor duplication policies", () => {
	it("allows duplicates by default", () => {
		const { agent, DescriptorType, Property } = createDescriptorFixture();

		const first = agent.addDescriptor(DescriptorType, 1)!;
		const second = agent.addDescriptor(DescriptorType, 10)!;

		expect(agent.getDescriptors(DescriptorType)).toEqual(new Set([first, second]));
		expect(agent.get(Property)).toBe(11);
	});

	it("allows duplicates when configured with allow", () => {
		const { agent, DescriptorType, Property } = createDescriptorFixture({ policy: "allow" });

		const first = agent.addDescriptor(DescriptorType, 1)!;
		const second = agent.addDescriptor(DescriptorType, 10)!;

		expect(agent.getDescriptors(DescriptorType)).toEqual(new Set([first, second]));
		expect(agent.get(Property)).toBe(11);
	});

	it("ignores duplicates until the existing descriptor is destroyed", () => {
		const { agent, DescriptorType, Property } = createDescriptorFixture({ policy: "ignore" });
		const first = agent.addDescriptor(DescriptorType, 1)!;

		expect(agent.addDescriptor(DescriptorType, 10)).toBeUndefined();
		expect(agent.getDescriptors(DescriptorType)).toEqual(new Set([first]));
		expect(agent.get(Property)).toBe(1);

		first.destroy();
		const replacement = agent.addDescriptor(DescriptorType, 10)!;

		expect(agent.getDescriptors(DescriptorType)).toEqual(new Set([replacement]));
		expect(agent.get(Property)).toBe(10);
	});

	it("replaces the existing descriptor and destroys its binding", () => {
		const { agent, bindingDestroyed, DescriptorType, Property } = createDescriptorFixture({
			policy: "replace",
		});
		const first = agent.addDescriptor(DescriptorType, 1)!;
		const second = agent.addDescriptor(DescriptorType, 10)!;

		expect(bindingDestroyed).toHaveBeenCalledOnce();
		expect(agent.getDescriptors(DescriptorType)).toEqual(new Set([second]));
		expect(agent.getDescriptors(DescriptorType)).not.toContain(first);
		expect(agent.get(Property)).toBe(10);
	});

	it("replaces atomically", () => {
		const { agent, DescriptorType, Property } = createDescriptorFixture({ policy: "replace" });
		const changed = vi.fn();
		agent.onPropertyChanged(Property, changed);

		agent.addDescriptor(DescriptorType, 1);
		agent.addDescriptor(DescriptorType, 10);

		expect(changed).toHaveBeenCalledTimes(2);
		expect(changed).toHaveBeenNthCalledWith(1, 1, 0);
		expect(changed).toHaveBeenNthCalledWith(2, 10, 1);
	});

	it("reconciles into the existing descriptor", () => {
		const reconcile = vi.fn((existing: Descriptor<number, number>, incoming: number) =>
			existing.set(incoming)
		);
		const { agent, DescriptorType, Property } = createDescriptorFixture({
			policy: "reconcile",
			reconcile,
		});
		const first = agent.addDescriptor(DescriptorType, 1)!;

		const duplicate = agent.addDescriptor(DescriptorType, 10);

		expect(duplicate).toBeUndefined();
		expect(reconcile).toHaveBeenCalledOnce();
		expect(reconcile).toHaveBeenCalledWith(first, 10);
		expect(agent.getDescriptors(DescriptorType)).toEqual(new Set([first]));
		expect(first.get()).toBe(10);
		expect(first.getSource().get()).toBe(10);
		expect(agent.get(Property)).toBe(10);
	});
});
