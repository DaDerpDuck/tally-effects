import type { AgentState } from "../../core/AgentState.js";
import { AgentMutationGate } from "../../core/AgentMutationGate.js";
import type { ReplicationEvent } from "../../replication/ReplicationEvent.js";
import type { ReplicationReceiver } from "../../replication/ReplicationReceiver.js";
import type { ReplicationSnapshot } from "../../replication/ReplicationSnapshot.js";
import type { ReplicationValue } from "../../replication/ReplicationValue.js";
import type { AnyDescriptor } from "../../state/descriptor/Descriptor.js";
import type { AnyDescriptorType, DescriptorType } from "../../state/descriptor/DescriptorType.js";
import type { DescriptorReplicationEvent } from "./DescriptorReplicationEvent.js";
import type { DescriptorId, ReplicatedDescriptor } from "./ReplicatedDescriptor.js";

/**
 * Reconstructs replicated Descriptors in an AgentState.
 *
 * Descriptor creation invokes the locally registered DescriptorHandler,
 * which recreates the Descriptor's derived Source.
 *
 * @see {@link ReplicationReceiver}
 */
export class DescriptorReceiver implements ReplicationReceiver {
	private readonly replicatedDescriptors = new Map<number, AnyDescriptor>();
	private readonly mutationGate: AgentMutationGate;
	/**
	 * @mutationReentrancy restricted
	 * @requiresMutationGate
	 */
	private readonly resolveType: (name: string) => AnyDescriptorType | undefined;

	constructor(
		private readonly agent: AgentState<unknown>,
		resolveType: (name: string) => AnyDescriptorType | undefined
	) {
		this.mutationGate = AgentMutationGate.forAgent(agent);
		this.resolveType = resolveType;
	}

	/** @checksMutationGate */
	apply(events: readonly ReplicationEvent[]) {
		this.mutationGate.assertMutationAllowed();
		const errors: { event: DescriptorReplicationEvent; error: Error }[] = [];

		this.agent.batch(() => {
			events
				.filter((event) => event.target === "descriptor")
				.map((event) => event.event)
				.forEach((event) => {
					try {
						if (event.kind === "added") this.addDescriptor(event.descriptor);
						else if (event.kind === "updated")
							this.updateDescriptor(event.id, event.data);
						else if (event.kind === "removed") this.removeDescriptor(event.id);
					} catch (err) {
						errors.push({
							event,
							error: err instanceof Error ? err : new Error(String(err)),
						});
					}
				});
		});

		if (errors.length > 0)
			throw new AggregateError(
				errors.map((e) => e.error),
				`Failed to apply ${errors.length} replication event(s)`
			);
	}

	/** @checksMutationGate */
	applySnapshot(snapshot: ReplicationSnapshot) {
		this.mutationGate.assertMutationAllowed();
		const errors: { descriptor: ReplicatedDescriptor; error: Error }[] = [];

		this.agent.batch(() => {
			const markForRemoval = new Set(this.replicatedDescriptors.keys());
			for (const replicatedDescriptor of snapshot.descriptors) {
				try {
					markForRemoval.delete(replicatedDescriptor.id);
					if (this.replicatedDescriptors.has(replicatedDescriptor.id))
						this.updateDescriptor(replicatedDescriptor.id, replicatedDescriptor.data);
					else this.addDescriptor(replicatedDescriptor);
				} catch (err) {
					errors.push({
						descriptor: replicatedDescriptor,
						error: err instanceof Error ? err : new Error(String(err)),
					});
				}
			}
			markForRemoval.forEach((id) => this.removeDescriptor(id));
		});

		if (errors.length > 0)
			throw new AggregateError(
				errors.map((e) => e.error),
				`Failed to apply ${errors.length} replication descriptors(s)`
			);
	}

	/** @providesMutationGate */
	private addDescriptor(replicatedDescriptor: ReplicatedDescriptor): AnyDescriptor {
		if (this.replicatedDescriptors.has(replicatedDescriptor.id))
			throw new Error("Attempted to add an existing replicated descriptor");
		const descriptorType = this.mutationGate.evaluate("descriptor-type-resolution", () =>
			this.resolveType(replicatedDescriptor.type)
		);
		if (!descriptorType)
			throw new Error("Attempted to add a nonexistent replicated descriptor");
		const replication = descriptorType.replication;
		if (!replication)
			throw new Error(
				"Attempted to add a replicated descriptor without a replication definition"
			);

		const data = this.mutationGate.evaluate("descriptor-deserialization", () =>
			replication.deserialize(replicatedDescriptor.data)
		);
		const descriptor = this.agent.addDescriptor(
			descriptorType as DescriptorType<unknown, unknown>,
			data,
			{
				key: replicatedDescriptor.key,
				provenance: {
					domain: "replicated",
					sequence: replicatedDescriptor.id,
				},
			}
		);
		if (!descriptor)
			throw new Error(
				"Unable to add a replicated descriptor due to handler returning undefined"
			);

		this.replicatedDescriptors.set(replicatedDescriptor.id, descriptor);
		descriptor.onDestroy(() => {
			if (this.replicatedDescriptors.get(replicatedDescriptor.id) === descriptor)
				this.replicatedDescriptors.delete(replicatedDescriptor.id);
		});
		return descriptor;
	}

	/** @providesMutationGate */
	private updateDescriptor(descriptorId: DescriptorId, data: ReplicationValue) {
		const descriptor = this.replicatedDescriptors.get(descriptorId);
		if (!descriptor)
			throw new Error(
				"Attempted to update a replicated descriptor without a locally created source"
			);
		const replication = descriptor.type.replication;
		if (!replication)
			throw new Error(
				"Attempted to update a replicated descriptor without a ReplicationDefinition"
			);
		const decoded = this.mutationGate.evaluate("descriptor-deserialization", () =>
			replication.deserialize(data)
		);
		descriptor.set(decoded);
	}

	private removeDescriptor(descriptorId: DescriptorId) {
		this.replicatedDescriptors.get(descriptorId)?.destroy();
		this.replicatedDescriptors.delete(descriptorId);
	}
}
