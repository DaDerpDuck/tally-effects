import type { Descriptor } from "./Descriptor.js";
import type { DescriptorOption } from "./DescriptorOption.js";
import type { DescriptorType } from "./DescriptorType.js";

type Writable<T> = {
	-readonly [K in keyof T]: T[K];
};

/**
 * A mutable, fluent set of Descriptor creation options for one DescriptorType.
 *
 * Option values persist across {@link add} calls.
 */
export class DescriptorBuilder<TDescriptorData, TSourceData> {
	private readonly buildData: Partial<Writable<DescriptorOption>> = {};

	constructor(
		private readonly type: DescriptorType<TDescriptorData, TSourceData>,
		private readonly create: (
			type: DescriptorType<TDescriptorData, TSourceData>,
			data: TDescriptorData,
			option: DescriptorOption
		) => Descriptor<TDescriptorData, TSourceData> | undefined
	) {}

	/** Sets the ordering and replication provenance for Descriptors added by this builder. */
	provenance(provenance: DescriptorOption["provenance"]) {
		this.buildData.provenance = provenance;
		return this;
	}

	/** Sets the duplication key for Descriptors added by this builder. */
	key(key: DescriptorOption["key"]) {
		this.buildData.key = key;
		return this;
	}

	/** Adds a Descriptor using the builder's current options. */
	add(
		this: [TDescriptorData] extends [undefined]
			? DescriptorBuilder<TDescriptorData, TSourceData>
			: never,
		data?: TDescriptorData
	): Descriptor<TDescriptorData, TSourceData> | undefined;
	add(data: TDescriptorData): Descriptor<TDescriptorData, TSourceData> | undefined;
	add(data: TDescriptorData): Descriptor<TDescriptorData, TSourceData> | undefined {
		return this.create(this.type, data!, this.buildData);
	}
}
