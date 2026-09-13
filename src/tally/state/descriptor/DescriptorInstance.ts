import type { DescriptorId } from "../../replication/descriptor/ReplicatedDescriptor.js";
import type { Disconnect } from "../../util/Disconnect.js";
import type { StateProvenance } from "../Provenance.js";
import type { Source } from "../source/Source.js";
import type { Descriptor } from "./Descriptor.js";
import type { DescriptorRuntime } from "./DescriptorRuntime.js";
import type { DescriptorType } from "./DescriptorType.js";

export interface DescriptorIdentity<TDescriptorData, TSourceData> {
	readonly id: DescriptorId;
	readonly type: DescriptorType<TDescriptorData, TSourceData>;
	readonly key: string | undefined;
	readonly provenance: StateProvenance;
	readonly data: TDescriptorData;
}

export class DescriptorInstance<TDescriptorData, TSourceData> implements Descriptor<
	TDescriptorData,
	TSourceData
> {
	readonly id: number;
	readonly type: DescriptorType<TDescriptorData, TSourceData>;
	readonly key: string | undefined;
	readonly provenance: StateProvenance;

	constructor(
		identity: DescriptorIdentity<TDescriptorData, TSourceData>,
		private readonly runtime: DescriptorRuntime<TDescriptorData, TSourceData>
	) {
		this.id = identity.id;
		this.type = identity.type;
		this.key = identity.key;
		this.provenance = identity.provenance;
	}

	get(): TDescriptorData {
		return this.runtime.get();
	}
	getSource(): Source<TSourceData> {
		return this.runtime.getSource();
	}
	set(data: TDescriptorData) {
		this.runtime.set(data);
	}
	destroy() {
		this.runtime.destroy();
	}
	onUpdate(callback: (self: Descriptor<TDescriptorData, TSourceData>) => void): Disconnect {
		return this.runtime.onUpdate(callback);
	}
	onDestroy(callback: (self: Descriptor<TDescriptorData, TSourceData>) => void): Disconnect {
		return this.runtime.onDestroy(callback);
	}
}
