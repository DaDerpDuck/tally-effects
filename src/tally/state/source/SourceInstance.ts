import type { Disconnect } from "../../util/Disconnect.js";
import type { StateProvenance } from "../Provenance.js";
import type { Source } from "./Source.js";
import type { SourceType } from "./SourceType.js";

export class SourceInstance<TData> implements Source<TData> {
	private readonly updateCallbacks = new Set<(self: this) => void>();
	private readonly destroyCallbacks = new Set<(self: this) => void>();
	private destroyed = false;

	constructor(
		public readonly id: number,
		public readonly type: SourceType<TData>,
		public readonly priority: number,
		public readonly key: string | undefined,
		public readonly provenance: StateProvenance,
		private data: TData
	) {}

	set(data: TData) {
		this.assertAlive();
		if (this.type.dataEquals(this.data, data)) return;
		this.data = data;
		for (const callback of this.updateCallbacks) {
			callback(this);
		}
	}

	get(): TData {
		return this.data;
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

	destroy(): void {
		if (this.destroyed) return;
		this.destroyed = true;
		this.destroyCallbacks.forEach((callback) => callback(this));
		this.updateCallbacks.clear();
		this.destroyCallbacks.clear();
	}

	private assertAlive() {
		if (this.destroyed) throw new Error("Source has been destroyed");
	}
}
