import type { Disconnect } from "../../util/Disconnect.js";
import type { StateProvenance } from "../Provenance.js";
import type { Source } from "./Source.js";
import type { SourceRuntime } from "./SourceRuntime.js";
import type { SourceType } from "./SourceType.js";

export interface SourceIdentity<TData> {
	readonly id: number;
	readonly type: SourceType<TData>;
	readonly priority: number;
	readonly key: string | undefined;
	readonly provenance: StateProvenance;
	readonly data: TData;
}

export class SourceInstance<TData> implements Source<TData> {
	readonly id: number;
	readonly type: SourceType<TData>;
	readonly priority: number;
	readonly key: string | undefined;
	readonly provenance: StateProvenance;

	constructor(
		identity: SourceIdentity<TData>,
		private readonly runtime: SourceRuntime<TData>
	) {
		this.id = identity.id;
		this.type = identity.type;
		this.priority = identity.priority;
		this.key = identity.key;
		this.provenance = identity.provenance;
	}

	get(): TData {
		return this.runtime.get();
	}
	set(data: TData): void {
		this.runtime.set(data);
	}
	destroy(): void {
		this.runtime.destroy();
	}
	onUpdate(callback: (self: Source<TData>) => void): Disconnect {
		return this.runtime.onUpdate(callback);
	}
	onDestroy(callback: (self: Source<TData>) => void): Disconnect {
		return this.runtime.onDestroy(callback);
	}
}
