import type { DescriptorId } from "../../replication/descriptor/ReplicatedDescriptor.js";
import type { Disconnect } from "../../util/Disconnect.js";
import type { StateProvenance } from "../Provenance.js";
import type { Source } from "../source/Source.js";
import type { Descriptor } from "./Descriptor.js";
import type { DescriptorBinding } from "./DescriptorBinding.js";
import type { DescriptorType } from "./DescriptorType.js";

export class DescriptorInstance<TDescriptorData, TSourceData> implements Descriptor<
	TDescriptorData,
	TSourceData
> {
	private readonly updateCallbacks = new Set<(self: this) => void>();
	private readonly destroyCallbacks = new Set<(self: this) => void>();
	private destroyed = false;

	constructor(
		public readonly id: DescriptorId,
		public readonly type: DescriptorType<TDescriptorData, TSourceData>,
		public readonly key: string | undefined,
		public readonly provenance: StateProvenance,
		private readonly binding: DescriptorBinding<TDescriptorData, TSourceData>,
		private data: TDescriptorData
	) {}

	set(data: TDescriptorData) {
		this.assertAlive();
		if (this.type.dataEquals(this.data, data)) return;
		this.data = data;
		this.binding.update(data);
		for (const callback of this.updateCallbacks) {
			callback(this);
		}
	}

	get(): TDescriptorData {
		return this.data;
	}

	getSource(): Source<TSourceData> {
		return this.binding.source;
	}

	onUpdate(callback: (self: this) => void): Disconnect {
		if (this.destroyed) return () => {};
		this.updateCallbacks.add(callback);
		return () => {
			this.updateCallbacks.delete(callback);
		};
	}

	onDestroy(callback: (self: this) => void): Disconnect {
		if (this.destroyed) return () => {};
		this.destroyCallbacks.add(callback);
		return () => {
			this.destroyCallbacks.delete(callback);
		};
	}

	destroy() {
		if (this.destroyed) return;
		this.destroyed = true;
		this.binding.destroy();
		this.destroyCallbacks.forEach((callback) => callback(this));
		this.updateCallbacks.clear();
		this.destroyCallbacks.clear();
	}

	private assertAlive() {
		if (this.destroyed) throw new Error("Descriptor has been destroyed");
	}
}
