import { expect } from "vitest";
import {
	AgentState,
	defineDescriptorType,
	defineNumberProperty,
	defineSourceType,
	DescriptorReceiver,
	type DescriptorType,
	type ReplicationDefinition,
	type ReplicationEvent,
	testReporter,
} from "../src/index.js";

export interface SourceData {
	readonly value: number;
}

export interface DescriptorData {
	readonly value: number;
	readonly sourceKey: string;
}

export const Value = defineNumberProperty({ name: "ReplicatedDescriptorValue", defaultValue: 0 });

export const sourceReplication: ReplicationDefinition<SourceData> = {
	serialize: (data) => data.value,
	deserialize: (serialized) => {
		if (typeof serialized !== "number") throw new Error("Expected a numeric Source value");
		return { value: serialized };
	},
};

export const descriptorReplication: ReplicationDefinition<DescriptorData> = {
	serialize: (data) => [data.value, data.sourceKey],
	deserialize: (serialized) => {
		if (
			!Array.isArray(serialized) ||
			typeof serialized[0] !== "number" ||
			typeof serialized[1] !== "string"
		)
			throw new Error("Expected serialized Descriptor data");
		return { value: serialized[0], sourceKey: serialized[1] };
	},
};

export const DescriptorSource = defineSourceType<SourceData>({
	name: "ReplicatedDescriptorSource",
	priority: 100,
	contribute: (data) => [Value.add(data.value)],
	replication: sourceReplication,
});

export const ValueDescriptor = defineDescriptorType<DescriptorData, SourceData>({
	name: "ReplicatedValueDescriptor",
	source: DescriptorSource,
	replication: descriptorReplication,
});

export function registerHandler(
	agent: AgentState<undefined>,
	descriptorType: DescriptorType<DescriptorData, SourceData>
) {
	agent.registerDescriptorHandler(descriptorType, (ctx, data) => {
		const source = ctx.addSource({ value: data.value }, { key: data.sourceKey });
		if (!source) return undefined;

		return {
			source,
			update(updated) {
				source.set({ value: updated.value });
			},
			destroy() {
				source.destroy();
			},
		};
	});
}

export interface ReplicationFixtureOptions {
	readonly beforeReplicationSubscribe?: (serverAgent: AgentState<undefined>) => void;
	readonly descriptorTypes?: readonly DescriptorType<DescriptorData, SourceData>[];
	readonly relayEvents?: boolean;
}

export function createReplicationFixture({
	beforeReplicationSubscribe,
	relayEvents = true,
	descriptorTypes = [],
}: ReplicationFixtureOptions = {}) {
	const allDescriptorTypes = [ValueDescriptor, ...descriptorTypes];
	const descriptorTypesByName = new Map(
		allDescriptorTypes.map((descriptorType) => [descriptorType.name, descriptorType])
	);
	const serverAgent = new AgentState(undefined, { reporter: testReporter });
	const clientAgent = new AgentState(undefined, { reporter: testReporter });
	for (const descriptorType of allDescriptorTypes) {
		registerHandler(serverAgent, descriptorType);
		registerHandler(clientAgent, descriptorType);
	}
	const receiver = new DescriptorReceiver(clientAgent, (name) => descriptorTypesByName.get(name));
	const emittedEvents: ReplicationEvent[] = [];

	beforeReplicationSubscribe?.(serverAgent);
	serverAgent.onReplicationEmit((event) => {
		emittedEvents.push(event);
		if (relayEvents) receiver.apply([event]);
	});

	return { clientAgent, emittedEvents, receiver, serverAgent };
}

export function getOnlyDescriptor(
	agent: AgentState<undefined>,
	descriptorType: DescriptorType<DescriptorData, SourceData> = ValueDescriptor
) {
	const descriptors = [...agent.getDescriptors(descriptorType)];
	expect(descriptors).toHaveLength(1);
	return descriptors[0]!;
}

export function expectOnlyEvent(events: ReplicationEvent[], expected: ReplicationEvent) {
	expect(events).toEqual([expected]);
	events.length = 0;
}
