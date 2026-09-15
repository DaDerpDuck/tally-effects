import { describe, expect, it } from "vitest";
import {
	AgentState,
	defineDescriptorType,
	defineNumberProperty,
	defineSourceType,
	testReporter,
} from "../src/index.js";

type OrderedData = {
	readonly operation: "add" | "multiply";
	readonly value: number;
};

const OrderedProperty = defineNumberProperty({
	name: "DescriptorOrderingProperty",
	defaultValue: 0,
});

const OrderedSource = defineSourceType<OrderedData>({
	name: "DescriptorOrderingSource",
	priority: 100,
	contribute: (data) =>
		data.operation === "add"
			? [OrderedProperty.add(data.value)]
			: [OrderedProperty.multiply(data.value)],
});

const OrderedDescriptor = defineDescriptorType<OrderedData, OrderedData>({
	name: "DescriptorOrderingDescriptor",
	source: OrderedSource,
	replication: {
		serialize: (data) => data,
		deserialize: (value) => {
			if (
				typeof value !== "object" ||
				value === null ||
				!("operation" in value) ||
				!("value" in value) ||
				(value.operation !== "add" && value.operation !== "multiply") ||
				typeof value.value !== "number"
			)
				throw new Error("Expected ordered descriptor data");

			return {
				operation: value.operation,
				value: value.value,
			};
		},
	},
});

const CounterBumpSource = defineSourceType<undefined>({
	name: "DescriptorOrderingCounterBump",
	priority: 100,
	contribute: () => [],
});

describe("deterministic Descriptor ordering integration", () => {
	it("makes a derived Source inherit its replicated Descriptor's authoritative order", () => {
		const agent = new AgentState({}, testReporter);
		agent.registerDescriptorHandler(OrderedDescriptor, (ctx, data) => {
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

		// Deliberately disturb the receiver-local creation counter. The authoritative order below
		// must win over whatever local counter happens to exist when the Descriptor handler runs.
		agent.addSource(CounterBumpSource);
		agent.addSource(CounterBumpSource);

		// Authoritative conceptual order is A (0), Descriptor B (1), C (2).
		// Create them locally in a different order so insertion history cannot satisfy the test.
		agent.addSource(
			OrderedSource,
			{ operation: "add", value: 2 },
			{ provenance: { domain: "replicated", sequence: 2 } }
		);

		const descriptor = agent.addDescriptor(
			OrderedDescriptor,
			{ operation: "multiply", value: 10 },
			{ provenance: { domain: "replicated", sequence: 1 } }
		)!;

		agent.addSource(
			OrderedSource,
			{ operation: "add", value: 1 },
			{ provenance: { domain: "replicated", sequence: 0 } }
		);

		// A Descriptor-owned Source remains descriptor-origin state, but it must occupy the same
		// authoritative sequence position as the Descriptor that caused it.
		expect(descriptor.getSource().provenance).toEqual({
			domain: "descriptor-replicated",
			sequence: 1,
		});

		// Correct authoritative order: (0 + 1) * 10 + 2 = 12.
		expect(agent.get(OrderedProperty)).toBe(12);
	});
});
