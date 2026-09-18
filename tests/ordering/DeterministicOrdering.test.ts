import { describe, expect, it } from "vitest";
import type { ModifierOrder } from "../../src/tally/modifier/ModifierOrder.js";
import { ModifierRegistry } from "../../src/tally/modifier/ModifierRegistry.js";
import { OrderingDomain } from "../../src/tally/modifier/OrderingDomain.js";
import {
	AgentState,
	defineSourceType,
	testReporter,
	type Modifier,
	type Property,
} from "../src/index.js";

const TraceProperty: Property<string> = {
	name: "DeterministicTrace",
	defaultValue: "",
	valueEquals: (a, b) => a === b,
	resolve: (base, modifiers) =>
		modifiers.reduce((result, modifier) => result + String(modifier.value), base),
};

function traceModifier(label: string): Modifier<string> {
	return {
		property: TraceProperty,
		operation: "append",
		value: label,
	};
}

function addOrderedModifier(registry: ModifierRegistry, label: string, order: ModifierOrder) {
	return registry.add(TraceProperty, traceModifier(label), order);
}

function resolveTrace(registry: ModifierRegistry) {
	return TraceProperty.resolve(TraceProperty.defaultValue, registry.get(TraceProperty));
}

function order(
	priority: number,
	domain: OrderingDomain,
	sequence: number,
	modifierIndex = 0
): ModifierOrder {
	return { priority, domain, sequence, modifierIndex };
}

describe("deterministic modifier ordering", () => {
	it("orders by priority before considering provenance", () => {
		const registry = new ModifierRegistry();

		addOrderedModifier(registry, "C", order(300, OrderingDomain.authoritative, 0));
		addOrderedModifier(registry, "A", order(100, OrderingDomain.local, 999));
		addOrderedModifier(registry, "B", order(200, OrderingDomain.authoritative, 999));

		expect(resolveTrace(registry)).toBe("ABC");
	});

	it("orders authoritative modifiers before local modifiers at equal priority", () => {
		const registry = new ModifierRegistry();

		// Insert authoritative first specifically so insertion order cannot accidentally satisfy the test.
		addOrderedModifier(registry, "A", order(100, OrderingDomain.authoritative, 50));
		addOrderedModifier(registry, "L", order(100, OrderingDomain.local, 0));

		expect(resolveTrace(registry)).toBe("AL");
	});

	it("orders modifiers by sequence within the same priority and domain", () => {
		const registry = new ModifierRegistry();

		addOrderedModifier(registry, "A", order(100, OrderingDomain.authoritative, 10));
		addOrderedModifier(registry, "C", order(100, OrderingDomain.authoritative, 30));
		addOrderedModifier(registry, "B", order(100, OrderingDomain.authoritative, 20));

		expect(resolveTrace(registry)).toBe("ABC");
	});

	it("orders modifiers from one Source by contribution index", () => {
		const registry = new ModifierRegistry();

		addOrderedModifier(registry, "A", order(100, OrderingDomain.authoritative, 10, 0));
		addOrderedModifier(registry, "C", order(100, OrderingDomain.authoritative, 10, 2));
		addOrderedModifier(registry, "B", order(100, OrderingDomain.authoritative, 10, 1));

		expect(resolveTrace(registry)).toBe("ABC");
	});

	it("applies the full ordering key lexicographically", () => {
		const registry = new ModifierRegistry();

		// Deliberately scrambled insertion order.
		addOrderedModifier(registry, "F", order(200, OrderingDomain.local, 0));
		addOrderedModifier(registry, "C", order(100, OrderingDomain.authoritative, 20, 0));
		addOrderedModifier(registry, "A", order(100, OrderingDomain.authoritative, 10, 0));
		addOrderedModifier(registry, "E", order(100, OrderingDomain.local, 0, 0));
		addOrderedModifier(registry, "D", order(100, OrderingDomain.authoritative, 20, 1));
		addOrderedModifier(registry, "B", order(100, OrderingDomain.authoritative, 10, 1));

		expect(resolveTrace(registry)).toBe("ABCDEF");
	});

	it("produces the same resolution from different insertion histories", () => {
		const first = new ModifierRegistry();
		const second = new ModifierRegistry();

		const entries = [
			["A", order(100, OrderingDomain.authoritative, 0)],
			["B", order(100, OrderingDomain.authoritative, 1)],
			["C", order(100, OrderingDomain.local, 0)],
			["D", order(200, OrderingDomain.authoritative, 0)],
		] as const;

		for (const [label, modifierOrder] of entries)
			addOrderedModifier(first, label, modifierOrder);

		for (const index of [2, 3, 0, 1] as const) {
			const [label, modifierOrder] = entries[index];
			addOrderedModifier(second, label, modifierOrder);
		}

		expect(resolveTrace(first)).toBe("ABCD");
		expect(resolveTrace(second)).toBe("ABCD");
		expect(resolveTrace(second)).toBe(resolveTrace(first));
	});

	it("keeps authoritative and local sequence namespaces independent", () => {
		const registry = new ModifierRegistry();

		addOrderedModifier(registry, "L1", order(100, OrderingDomain.local, 1));
		addOrderedModifier(registry, "A1", order(100, OrderingDomain.authoritative, 1));
		addOrderedModifier(registry, "L0", order(100, OrderingDomain.local, 0));
		addOrderedModifier(registry, "A0", order(100, OrderingDomain.authoritative, 0));

		expect(resolveTrace(registry)).toBe("A0A1L0L1");
	});
});

interface OrderedSourceData {
	readonly label: string;
}

const OrderedSource = defineSourceType<OrderedSourceData>({
	name: "DeterministicOrderedSource",
	priority: 100,
	contribute: (data) => [
		{
			applyTo(registry, priority) {
				return registry.add(TraceProperty, traceModifier(data.label), priority);
			},
		},
	],
});

describe("deterministic Source ordering integration", () => {
	it("does not let local creation time override authoritative ordering", () => {
		const agent = new AgentState({}, { reporter: testReporter });

		agent.addSource(
			OrderedSource,
			{ label: "L" },
			{ provenance: { domain: "local", sequence: 0 } }
		);
		agent.addSource(
			OrderedSource,
			{ label: "B" },
			{ provenance: { domain: "replicated", sequence: 1 } }
		);
		agent.addSource(
			OrderedSource,
			{ label: "A" },
			{ provenance: { domain: "replicated", sequence: 0 } }
		);

		expect(agent.get(TraceProperty)).toBe("ABL");
	});

	it("keeps a Source in the same ordering position after it updates", () => {
		const agent = new AgentState({}, { reporter: testReporter });

		const first = agent.addSource(
			OrderedSource,
			{ label: "A" },
			{ provenance: { domain: "replicated", sequence: 0 } }
		)!;
		agent.addSource(
			OrderedSource,
			{ label: "B" },
			{ provenance: { domain: "replicated", sequence: 1 } }
		);

		expect(agent.get(TraceProperty)).toBe("AB");

		first.set({ label: "A2" });

		// Updating removes and reapplies modifier handles. The Source must retain its semantic position.
		expect(agent.get(TraceProperty)).toBe("A2B");
	});

	it("converges when the same authoritative Sources are created in different local orders", () => {
		const firstAgent = new AgentState({}, { reporter: testReporter });
		const secondAgent = new AgentState({}, { reporter: testReporter });

		firstAgent.addSource(
			OrderedSource,
			{ label: "A" },
			{ provenance: { domain: "replicated", sequence: 0 } }
		);
		firstAgent.addSource(
			OrderedSource,
			{ label: "B" },
			{ provenance: { domain: "replicated", sequence: 1 } }
		);
		firstAgent.addSource(
			OrderedSource,
			{ label: "C" },
			{ provenance: { domain: "replicated", sequence: 2 } }
		);

		secondAgent.addSource(
			OrderedSource,
			{ label: "C" },
			{ provenance: { domain: "replicated", sequence: 2 } }
		);
		secondAgent.addSource(
			OrderedSource,
			{ label: "A" },
			{ provenance: { domain: "replicated", sequence: 0 } }
		);
		secondAgent.addSource(
			OrderedSource,
			{ label: "B" },
			{ provenance: { domain: "replicated", sequence: 1 } }
		);

		expect(firstAgent.get(TraceProperty)).toBe("ABC");
		expect(secondAgent.get(TraceProperty)).toBe("ABC");
		expect(secondAgent.get(TraceProperty)).toBe(firstAgent.get(TraceProperty));
	});
});
