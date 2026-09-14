import type { AgentState } from "../../core/AgentState.js";
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

	constructor(
		private readonly agent: AgentState<unknown>,
		private readonly resolveType: (name: string) => AnyDescriptorType | undefined
	) {}

	apply(events: readonly ReplicationEvent[]) {
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

	applySnapshot(snapshot: ReplicationSnapshot) {
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

	private addDescriptor(replicatedDescriptor: ReplicatedDescriptor): AnyDescriptor {
		if (this.replicatedDescriptors.has(replicatedDescriptor.id))
			throw new Error("Attempted to add an existing replicated descriptor");
		const descriptorType = this.resolveType(replicatedDescriptor.type);
		if (!descriptorType)
			throw new Error("Attempted to add a nonexistent replicated descriptor");
		if (!descriptorType.replication)
			throw new Error(
				"Attempted to add a replicated descriptor without a replication definition"
			);

		const descriptor = this.agent.addDescriptor(
			descriptorType as DescriptorType<unknown, unknown>,
			descriptorType.replication.deserialize(replicatedDescriptor.data),
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

	private updateDescriptor(descriptorId: DescriptorId, data: ReplicationValue) {
		const descriptor = this.replicatedDescriptors.get(descriptorId);
		if (!descriptor)
			throw new Error(
				"Attempted to update a replicated descriptor without a locally created source"
			);
		if (!descriptor.type.replication)
			throw new Error(
				"Attempted to update a replicated descriptor without a ReplicationDefinition"
			);
		descriptor.set(descriptor.type.replication.deserialize(data));
	}

	private removeDescriptor(descriptorId: DescriptorId) {
		this.replicatedDescriptors.get(descriptorId)?.destroy();
		this.replicatedDescriptors.delete(descriptorId);
	}
}
