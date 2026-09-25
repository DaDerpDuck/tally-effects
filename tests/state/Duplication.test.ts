import { describe, expect, it, vi } from "vitest";
import type { Descriptor, Source } from "../src/index.js";
import {
	createDescriptorDuplicationFixture,
	createSourceDuplicationFixture,
} from "../fixtures/Duplication.js";

describe("source duplication policies", () => {
	it.each([
		["by default", undefined],
		["when configured with allow", { policy: "allow" }],
	] as const)("allows duplicates %s", (_description, duplication) => {
		const { agent, Property, SourceType } = createSourceDuplicationFixture(duplication);

		const first = agent.addSource(SourceType, 1)!;
		const second = agent.addSource(SourceType, 10)!;

		expect(agent.getSources(SourceType)).toEqual(new Set([first, second]));
		expect(agent.get(Property)).toBe(11);
	});

	it("ignores duplicates until the existing source is destroyed", () => {
		const { agent, Property, SourceType } = createSourceDuplicationFixture({
			policy: "ignore",
		});
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
		const { agent, Property, SourceType } = createSourceDuplicationFixture({
			policy: "replace",
		});
		const first = agent.addSource(SourceType, 1)!;
		const second = agent.addSource(SourceType, 10)!;

		expect(agent.getSources(SourceType)).toEqual(new Set([second]));
		expect(agent.getSources(SourceType)).not.toContain(first);
		expect(agent.get(Property)).toBe(10);
	});

	it("replaces atomically", () => {
		const { agent, Property, SourceType } = createSourceDuplicationFixture({
			policy: "replace",
		});
		const changed = vi.fn();
		agent.onPropertyChanged(Property, changed);

		agent.addSource(SourceType, 1);
		agent.addSource(SourceType, 10);

		expect(changed).toHaveBeenCalledTimes(2);
		expect(changed).toHaveBeenNthCalledWith(1, 1, 0);
		expect(changed).toHaveBeenNthCalledWith(2, 10, 1);
	});

	it("preserves the stack limit when an eviction callback adds a duplicate", () => {
		const { agent, SourceType } = createSourceDuplicationFixture({ policy: "replace" });
		const first = agent.addSource(SourceType, 1)!;
		first.onDestroy(() => agent.addSource(SourceType, 2));

		agent.addSource(SourceType, 3);

		expect(agent.getSources(SourceType).size).toBe(1);
	});

	it("reconciles into the existing source", () => {
		const reconcile = vi.fn((existing: Source<number>, incoming: number) =>
			existing.set(incoming)
		);
		const { agent, Property, SourceType } = createSourceDuplicationFixture({
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
	it.each([
		["by default", undefined],
		["when configured with allow", { policy: "allow" }],
	] as const)("allows duplicates %s", (_description, duplication) => {
		const { agent, DescriptorType, Property } = createDescriptorDuplicationFixture(duplication);

		const first = agent.addDescriptor(DescriptorType, 1)!;
		const second = agent.addDescriptor(DescriptorType, 10)!;

		expect(agent.getDescriptors(DescriptorType)).toEqual(new Set([first, second]));
		expect(agent.get(Property)).toBe(11);
	});

	it("ignores duplicates until the existing descriptor is destroyed", () => {
		const { agent, DescriptorType, Property } = createDescriptorDuplicationFixture({
			policy: "ignore",
		});
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
		const { agent, bindingDestroyed, DescriptorType, Property } =
			createDescriptorDuplicationFixture({
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
		const { agent, DescriptorType, Property } = createDescriptorDuplicationFixture({
			policy: "replace",
		});
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
		const { agent, DescriptorType, Property } = createDescriptorDuplicationFixture({
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
