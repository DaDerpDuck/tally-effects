import type { Source } from "./Source.js";
import type { SourceOption } from "./SourceOption.js";
import type { SourceType } from "./SourceType.js";

type Writable<T> = {
	-readonly [K in keyof T]: T[K];
};

/**
 * A mutable, fluent set of Source creation options for one SourceType.
 *
 * Option values persist across {@link add} calls.
 */
export class SourceBuilder<TData> {
	private readonly buildData: Partial<Writable<SourceOption>> = {};

	constructor(
		private readonly type: SourceType<TData>,
		private readonly create: (
			type: SourceType<TData>,
			data: TData,
			option: SourceOption
		) => Source<TData> | undefined
	) {}

	/** Overrides the SourceType priority for Sources added by this builder. */
	priority(priority: SourceOption["priority"]) {
		this.buildData.priority = priority;
		return this;
	}

	/** Sets the ordering and replication provenance for Sources added by this builder. */
	provenance(provenance: SourceOption["provenance"]) {
		this.buildData.provenance = provenance;
		return this;
	}

	/** Sets the duplication key for Sources added by this builder. */
	key(key: SourceOption["key"]) {
		this.buildData.key = key;
		return this;
	}

	/** Adds a Source using the builder's current options. */
	add(
		this: [TData] extends [undefined] ? SourceBuilder<TData> : never,
		data?: TData
	): Source<TData> | undefined;
	add(data: TData): Source<TData> | undefined;
	add(data: TData): Source<TData> | undefined {
		return this.create(this.type, data!, this.buildData);
	}
}
