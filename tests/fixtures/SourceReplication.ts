import { expect } from "vitest";
import {
	AgentState,
	defineNumberProperty,
	defineSourceType,
	SourceReceiver,
	type ReplicationEvent,
	type SourceType,
	testReporter,
} from "../src/index.js";

export interface SourceData {
	readonly value: number;
}

export const Value = defineNumberProperty({ name: "ReplicatedSourceValue", defaultValue: 0 });

export function defineReplicatedSource(name: string) {
	return defineSourceType<SourceData>({
		name,
		priority: 100,
		contribute: (data) => [Value.add(data.value)],
		replication: {
			serialize: (data) => data.value,
			deserialize: (serialized) => {
				if (typeof serialized !== "number")
					throw new Error("Expected a numeric Source value");
				return { value: serialized };
			},
		},
	});
}

export const ValueSource = defineReplicatedSource("ReplicatedValueSource");

export interface ReplicationFixtureOptions {
	readonly beforeReplicationSubscribe?: (serverAgent: AgentState<undefined>) => void;
	readonly relayEvents?: boolean;
	readonly sourceTypes?: readonly SourceType<SourceData>[];
}

export function createReplicationFixture({
	beforeReplicationSubscribe,
	relayEvents = true,
	sourceTypes = [],
}: ReplicationFixtureOptions = {}) {
	const allSourceTypes = [ValueSource, ...sourceTypes];
	const sourceTypesByName = new Map(
		allSourceTypes.map((sourceType) => [sourceType.name, sourceType])
	);
	const serverAgent = new AgentState(undefined, { reporter: testReporter });
	const clientAgent = new AgentState(undefined, { reporter: testReporter });
	const receiver = new SourceReceiver(clientAgent, (name) => sourceTypesByName.get(name));
	const emittedEvents: ReplicationEvent[] = [];

	beforeReplicationSubscribe?.(serverAgent);
	serverAgent.onReplicationEmit((event) => {
		emittedEvents.push(event);
		if (relayEvents) receiver.apply([event]);
	});

	return {
		clientAgent,
		emittedEvents,
		receiver,
		serverAgent,
	};
}

export function getOnlySource(
	agent: AgentState<undefined>,
	sourceType: SourceType<SourceData> = ValueSource
) {
	const sources = [...agent.getSources(sourceType)];
	expect(sources).toHaveLength(1);
	return sources[0]!;
}

export function getSourceNames(agent: AgentState<undefined>) {
	return new Set(
		agent
			.getSources()
			.values()
			.map((source) => source.type.name)
	);
}
