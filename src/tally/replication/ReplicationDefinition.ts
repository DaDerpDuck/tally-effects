import type { ReplicationValue } from "./ReplicationValue.js";

export interface AnyReplicationDefinition {
	/**
	 * @mutationReentrancy restricted
	 * @requiresMutationGate
	 */
	deserialize(serialized: ReplicationValue): unknown;
}

export interface ReplicationDefinition<TData> extends AnyReplicationDefinition {
	/**
	 * @mutationReentrancy restricted
	 * @requiresMutationGate
	 */
	serialize(data: TData): ReplicationValue;
	/**
	 * @mutationReentrancy restricted
	 * @requiresMutationGate
	 */
	deserialize(serialized: ReplicationValue): TData;
}
