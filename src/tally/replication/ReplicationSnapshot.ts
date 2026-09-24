import type { AgentState } from "../core/AgentState.js";
import { AgentMutationGate } from "../core/AgentMutationGate.js";
import {
	type ReplicatedDescriptor,
	serializeDescriptor,
} from "./descriptor/ReplicatedDescriptor.js";
import { type ReplicatedSource, serializeSource } from "./source/ReplicatedSource.js";

/**
 * Represents a complete authoritative replication state suitable for
 * initial synchronization or reconciliation.
 */
export interface ReplicationSnapshot {
	readonly sources: readonly ReplicatedSource[];
	readonly descriptors: readonly ReplicatedDescriptor[];
}

/** @providesMutationGate */
export function createReplicationSnapshot(agent: AgentState<unknown>): ReplicationSnapshot {
	const mutationGate = AgentMutationGate.forAgent(agent);
	return {
		sources: agent
			.getSources()
			.values()
			.filter(
				(source) =>
					source.type.replication !== undefined && source.provenance.domain === "local"
			)
			.map((source) =>
				mutationGate.evaluate("source-serialization", () => serializeSource(source))
			)
			.toArray(),
		descriptors: agent
			.getDescriptors()
			.values()
			.filter(
				(descriptor) =>
					descriptor.type.replication !== undefined &&
					descriptor.provenance.domain === "local"
			)
			.map((descriptor) =>
				mutationGate.evaluate("descriptor-serialization", () =>
					serializeDescriptor(descriptor)
				)
			)
			.toArray(),
	};
}
