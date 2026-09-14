import { describe, expect, it } from "vitest";
import {
	createReplicationSnapshot,
	defineDescriptorType,
	defineNumberProperty,
	defineSourceType,
	DescriptorReceiver,
	SourceReceiver,
	TallyContext,
	type ReplicationValue,
} from "../../src/index.js";
import { testReporter } from "../src/index.js";

type OrderedData = {
	readonly operation: "add" | "multiply";
	readonly value: number;
};

const OrderedProperty = defineNumberProperty({
	name: "ReplicationOrderingProperty",
	defaultValue: 0,
});

function deserializeOrderedData(value: ReplicationValue): OrderedData {
	if (
		typeof value !== "object" ||
		value === null ||
		!("operation" in value) ||
		!("value" in value) ||
		(value.operation !== "add" && value.operation !== "multiply") ||
		typeof value.value !== "number"
	)
		throw new Error("Expected ordered data");

	return { operation: value.operation, value: value.value };
}

const OrderedSource = defineSourceType<OrderedData>({
	name: "ReplicationOrderingSource",
	priority: 100,
	contribute: (data) =>
		data.operation === "add"
			? [OrderedProperty.add(data.value)]
			: [OrderedProperty.multiply(data.value)],
	replication: {
		serialize: (data) => data,
		deserialize: deserializeOrderedData,
	},
});

const OrderedDescriptor = defineDescriptorType<OrderedData, OrderedData>({
	name: "ReplicationOrderingDescriptor",
	source: OrderedSource,
	replication: {
		serialize: (data) => data,
		deserialize: deserializeOrderedData,
	},
});

function registerDescriptorHandler(tally: TallyContext<undefined>) {
	tally.registerDescriptorHandler(OrderedDescriptor, (ctx, data) => {
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
}

function configureTally(tally: TallyContext<undefined>) {
	registerDescriptorHandler(tally);
	tally.register(OrderedProperty);
	tally.register(OrderedSource);
	tally.register(OrderedDescriptor);
}

function createClient() {
	const tally = new TallyContext<undefined>(testReporter);
	configureTally(tally);
	const agent = tally.createAgentState(undefined);
	const sourceReceiver = new SourceReceiver(agent, (name) => tally.sources.get(name));
	const descriptorReceiver = new DescriptorReceiver(agent, (name) => tally.descriptors.get(name));
	return { agent, descriptorReceiver, sourceReceiver, tally };
}

function populateAuthoritativeState(
	agent: ReturnType<TallyContext<undefined>["createAgentState"]>
) {
	agent.addSource(OrderedSource, { operation: "add", value: 1 });
	agent.addDescriptor(OrderedDescriptor, { operation: "multiply", value: 10 });
	agent.addSource(OrderedSource, { operation: "add", value: 2 });
}

describe("replicated deterministic ordering convergence", () => {
	it("resolves the same order-sensitive value across live Source and Descriptor replication", () => {
		const serverTally = new TallyContext<undefined>(testReporter);
		configureTally(serverTally);
		const serverAgent = serverTally.createAgentState(undefined);
		const client = createClient();

		serverTally.onReplicationEmit((_, event) => {
			client.sourceReceiver.apply([event]);
			client.descriptorReceiver.apply([event]);
		});

		populateAuthoritativeState(serverAgent);

		expect(serverAgent.get(OrderedProperty)).toBe(12);
		expect(client.agent.get(OrderedProperty)).toBe(12);
		expect(client.agent.get(OrderedProperty)).toBe(serverAgent.get(OrderedProperty));
	});

	it("converges from snapshots regardless of Source/Descriptor reconciliation order", () => {
		const serverTally = new TallyContext<undefined>(testReporter);
		configureTally(serverTally);
		const serverAgent = serverTally.createAgentState(undefined);
		populateAuthoritativeState(serverAgent);
		const snapshot = createReplicationSnapshot(serverAgent);

		const sourceFirst = createClient();
		sourceFirst.sourceReceiver.applySnapshot(snapshot);
		sourceFirst.descriptorReceiver.applySnapshot(snapshot);

		const descriptorFirst = createClient();
		descriptorFirst.descriptorReceiver.applySnapshot(snapshot);
		descriptorFirst.sourceReceiver.applySnapshot(snapshot);

		expect(serverAgent.get(OrderedProperty)).toBe(12);
		expect(sourceFirst.agent.get(OrderedProperty)).toBe(12);
		expect(descriptorFirst.agent.get(OrderedProperty)).toBe(12);
		expect(sourceFirst.agent.get(OrderedProperty)).toBe(serverAgent.get(OrderedProperty));
		expect(descriptorFirst.agent.get(OrderedProperty)).toBe(serverAgent.get(OrderedProperty));
	});
});
