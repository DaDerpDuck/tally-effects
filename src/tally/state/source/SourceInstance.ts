import type { ModifierHandle } from "../../modifier/ModifierRegistry.js";
import type { Disconnect } from "../../util/Disconnect.js";
import { CallbackSet, throwCallbackErrors } from "../../util/CallbackSet.js";
import type { AdmissionRuntime, RuntimeOwnership } from "../AdmissionRuntime.js";
import type { AdmissionLease } from "../AdmissionTransaction.js";
import type { StateProvenance } from "../Provenance.js";
import type { Source } from "./Source.js";
import type { SourceContribution } from "./SourceContribution.js";
import type { SourceType } from "./SourceType.js";

export interface SourceHost<TData> {
	contributeModifiers<TData>(type: SourceType<TData>, data: TData): SourceContribution;
	applyModifiers(
		contributions: SourceContribution,
		source: SourceInstance<TData>
	): ModifierHandle[];
	discardModifiers(handles: ModifierHandle[]): void;
	changeModifiers(
		source: SourceInstance<TData>,
		oldHandles: ModifierHandle[],
		newContributions: SourceContribution
	): ModifierHandle[];
	installSource(source: SourceInstance<TData>, handles: ModifierHandle[]): void;
	uninstallSource(source: SourceInstance<TData>, handles: ModifierHandle[]): void;
	announceAdded(source: SourceInstance<TData>): void;
	announceUpdated(source: SourceInstance<TData>): void;
	announceDestroyed(source: SourceInstance<TData>): void;
}

export interface SourceIdentity<TData> {
	readonly id: number;
	readonly type: SourceType<TData>;
	readonly priority: number;
	readonly key: string | undefined;
	readonly provenance: StateProvenance;
	readonly data: TData;
}

interface SourceController<TData> {
	get(): TData;
	set(data: TData): void;
	destroy(): void;
	onUpdate(callback: (self: Source<TData>) => void): Disconnect;
	onDestroy(callback: (self: Source<TData>) => void): Disconnect;
}

export class SourceRuntime<TData> implements SourceController<TData>, AdmissionRuntime<TData> {
	public readonly instance: SourceInstance<TData>;
	public readonly type: SourceType<TData>;
	private readonly updateCallbacks = new CallbackSet<[self: Source<TData>]>();
	private readonly destroyCallbacks = new CallbackSet<[self: Source<TData>]>();
	private ownership: RuntimeOwnership;
	private data: TData;
	private contributions: SourceContribution | undefined;
	private handles: ModifierHandle[] = [];
	private dataRevision = 0;
	private installed = false;
	private announced = false;

	constructor(
		lease: AdmissionLease,
		identity: SourceIdentity<TData>,
		private readonly host: SourceHost<TData>
	) {
		this.type = identity.type;
		this.data = identity.data;
		this.ownership = {
			kind: "admitting",
			lease,
		};
		this.instance = new SourceInstance(identity, this);
	}

	prepare(): void {
		if (this.ownership.kind !== "admitting")
			throw new Error("Cannot prepare a non-admitting runtime");
		const lease = this.ownership.lease;
		while (!lease.isTerminal()) {
			const revision = this.dataRevision;
			const contributions = this.host.contributeModifiers(this.type, this.data);
			if (lease.isTerminal()) return;

			if (this.dataRevision !== revision) continue;

			this.contributions = contributions;
			return;
		}
	}

	install(): void {
		if (this.ownership.kind !== "admitting")
			throw new Error("Cannot install a non-admitting runtime");
		if (this.installed || this.ownership.lease.isTerminal()) return;
		if (this.contributions === undefined) return;
		this.handles = this.host.applyModifiers(this.contributions, this.instance);
		this.host.installSource(this.instance, this.handles);
		this.installed = true;
	}

	announceAdded(): void {
		if (this.ownership.kind !== "admitting")
			throw new Error("Cannot announce a non-admitting runtime");
		if (this.announced || this.ownership.lease.isTerminal()) return;
		this.announced = true; // set before callbacks, they may destroy this source
		this.host.announceAdded(this.instance);
	}

	markLive(unlink: () => void): void {
		if (this.ownership.kind !== "admitting")
			throw new Error("Cannot install a non-admitting runtime");
		if (!this.installed || !this.announced || this.ownership.lease.isTerminal())
			throw new Error("Cannot complete an incomplete admission");
		this.ownership = {
			kind: "live",
			unlink,
		};
	}

	rollbackAdmission(): void {
		if (this.ownership.kind !== "admitting") return;
		if (this.installed) this.host.uninstallSource(this.instance, this.handles);
		else this.host.discardModifiers(this.handles);

		this.handles.length = 0;
		this.contributions = undefined;
		this.ownership = { kind: "destroyed" };
		this.updateCallbacks.clear();
		const errors: unknown[] = [];
		if (this.announced) {
			errors.push(...this.destroyCallbacks.emit(this.instance));
			try {
				this.host.announceDestroyed(this.instance);
			} catch (error) {
				errors.push(error);
			}
		}
		this.destroyCallbacks.clear();
		throwCallbackErrors(errors, "Errors occurred while rolling back Source admission");
	}

	get(): TData {
		return this.data;
	}

	set(data: TData): void {
		this.assertAlive();
		if (this.type.dataEquals(this.data, data)) return;

		this.data = data;
		this.dataRevision++;

		if (!this.installed) return;

		// reentry may have called set on this source
		while (!this.isInactive()) {
			const revision = this.dataRevision;
			const nextContributions = this.host.contributeModifiers(this.type, this.data);
			if (this.isInactive()) return;

			if (this.dataRevision !== revision) continue;

			this.contributions = nextContributions;
			break;
		}

		this.handles = this.host.changeModifiers(this.instance, this.handles, this.contributions!);

		if (this.isInactive()) return;
		const errors = this.updateCallbacks.emit(this.instance);
		if (this.isInactive())
			return throwCallbackErrors(errors, "Errors occurred while updating Source");
		try {
			this.host.announceUpdated(this.instance);
		} catch (error) {
			errors.push(error);
		}
		throwCallbackErrors(errors, "Errors occurred while updating Source");
	}

	destroy(): void {
		if (this.ownership.kind === "destroyed") return;

		if (this.ownership.kind === "admitting") {
			this.ownership.lease.cancel();
			return;
		}

		const { unlink } = this.ownership;
		this.ownership = { kind: "destroyed" };

		unlink();
		this.host.uninstallSource(this.instance, this.handles);

		this.updateCallbacks.clear();
		const errors = this.destroyCallbacks.emit(this.instance);
		this.destroyCallbacks.clear();
		try {
			this.host.announceDestroyed(this.instance);
		} catch (error) {
			errors.push(error);
		}
		throwCallbackErrors(errors, "Errors occurred while destroying Source");
	}

	onUpdate(callback: (self: Source<TData>) => void): Disconnect {
		if (this.ownership.kind === "destroyed") return () => {};
		return this.updateCallbacks.add(callback);
	}

	onDestroy(callback: (self: Source<TData>) => void): Disconnect {
		if (this.ownership.kind === "destroyed") return () => {};
		return this.destroyCallbacks.add(callback);
	}

	private assertAlive() {
		if (this.ownership.kind === "destroyed") throw new Error("Source has been destroyed");
	}

	private isInactive() {
		return (
			this.ownership.kind === "destroyed" ||
			(this.ownership.kind === "admitting" && this.ownership.lease.isTerminal())
		);
	}
}

export class SourceInstance<TData> implements Source<TData> {
	public readonly id: number;
	public readonly type: SourceType<TData>;
	public readonly priority: number;
	public readonly key: string | undefined;
	public readonly provenance: StateProvenance;

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
