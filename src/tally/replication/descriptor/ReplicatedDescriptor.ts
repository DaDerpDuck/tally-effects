import type { ReplicationValue } from "../../replication/ReplicationValue.js";
import type { AnyDescriptor } from "../../state/descriptor/Descriptor.js";

export type DescriptorId = number;

export interface ReplicatedDescriptor {
	readonly id: DescriptorId;
	readonly type: string;
	readonly key: string | undefined;
	readonly data: ReplicationValue;
}

export function serializeDescriptor(descriptor: AnyDescriptor): ReplicatedDescriptor {
	if (!descriptor.type.replication)
		throw new Error("Cannot serialize a descriptor without a ReplicationDefinition");
	return {
		id: descriptor.id,
		type: descriptor.type.name,
		key: descriptor.key,
		data: descriptor.type.replication.serialize(descriptor.get()),
	};
}
