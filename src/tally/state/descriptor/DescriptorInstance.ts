import type { DescriptorId } from "../../replication/descriptor/ReplicatedDescriptor.js";
import { CallbackSet, throwCallbackErrors } from "../../util/CallbackSet.js";
import type { Disconnect } from "../../util/Disconnect.js";
import type { AdmissionRuntime, RuntimeOwnership } from "../AdmissionRuntime.js";
import type { AdmissionLease } from "../AdmissionTransaction.js";
import type { StateProvenance } from "../Provenance.js";
import type { Source } from "../source/Source.js";
import type { Descriptor } from "./Descriptor.js";
import type { DescriptorBinding } from "./DescriptorBinding.js";
import type { DescriptorType } from "./DescriptorType.js";

export interface DescriptorHost<TDescriptorData, TSourceData> {
	tryBind(derivedSources: Source[]): DescriptorBinding<TDescriptorData, TSourceData> | undefined;
	installDescriptor(descriptor: DescriptorInstance<TDescriptorData, TSourceData>): void;
	uninstallDescriptor(descriptor: DescriptorInstance<TDescriptorData, TSourceData>): void;
	announceAdded(source: DescriptorInstance<TDescriptorData, TSourceData>): void;
	announceUpdated(source: DescriptorInstance<TDescriptorData, TSourceData>): void;
	announceDestroyed(source: DescriptorInstance<TDescriptorData, TSourceData>): void;
}

export interface DescriptorIdentity<TDescriptorData, TSourceData> {
	readonly id: DescriptorId;
	readonly type: DescriptorType<TDescriptorData, TSourceData>;
	readonly key: string | undefined;
	readonly provenance: StateProvenance;
	readonly data: TDescriptorData;
}

interface DescriptorController<TDescriptorData, TSourceData> {
	get(): TDescriptorData;
	getSource(): Source<TSourceData>;
	set(data: TDescriptorData): void;
	destroy(): void;
	onUpdate(callback: (self: Descriptor<TDescriptorData, TSourceData>) => void): Disconnect;
	onDestroy(callback: (self: Descriptor<TDescriptorData, TSourceData>) => void): Disconnect;
}

export class DescriptorRuntime<TDescriptorData, TSourceData>
	implements DescriptorController<TDescriptorData, TSourceData>, AdmissionRuntime<TDescriptorData>
{
	public readonly instance: DescriptorInstance<TDescriptorData, TSourceData>;
	public readonly type: DescriptorType<TDescriptorData, TSourceData>;
	private readonly derivedSources = new Array<Source>();
	private readonly updateCallbacks = new CallbackSet<
		[self: Descriptor<TDescriptorData, TSourceData>]
	>();
	private readonly destroyCallbacks = new CallbackSet<
		[self: Descriptor<TDescriptorData, TSourceData>]
	>();
	private ownership: RuntimeOwnership;
	private binding: DescriptorBinding<TDescriptorData, TSourceData> | undefined;
	private data: TDescriptorData;
	private installed = false;
	private announced = false;

	constructor(
		lease: AdmissionLease,
		identity: DescriptorIdentity<TDescriptorData, TSourceData>,
		private readonly host: DescriptorHost<TDescriptorData, TSourceData>
	) {
		this.type = identity.type;
		this.data = identity.data;
		this.ownership = {
			kind: "admitting",
			lease,
		};
		this.instance = new DescriptorInstance(identity, this);
	}

	prepare(): void {
		// descriptor doesn't have any prepare step
	}

	install(): void {
		if (this.ownership.kind !== "admitting")
			throw new Error("Cannot install a non-admitting runtime");

		const lease = this.ownership.lease;
		const binding = this.host.tryBind(this.derivedSources);

		// The handler may have called descriptor.destroy().
		if (lease.isTerminal()) {
			this.cleanupBinding();
			return;
		}

		if (!binding) {
			lease.cancel();
			return;
		}

		this.binding = binding;

		this.host.installDescriptor(this.instance);
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
		if (this.installed) this.host.uninstallDescriptor(this.instance);
		this.cleanupBinding();

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
		throwCallbackErrors(errors, "Errors occurred while rolling back Descriptor admission");
	}

	get(): TDescriptorData {
		return this.data;
	}

	getSource(): Source<TSourceData> {
		if (!this.binding) throw new Error("Descriptor binding has not yet been invoked");
		return this.binding.source;
	}

	set(data: TDescriptorData) {
		this.assertAlive();
		if (this.type.dataEquals(this.data, data)) return;
		this.data = data;
		this.binding?.update(data);
		if (this.isInactive()) return;
		const errors = this.updateCallbacks.emit(this.instance);
		if (this.isInactive())
			return throwCallbackErrors(errors, "Errors occurred while updating Descriptor");
		try {
			this.host.announceUpdated(this.instance);
		} catch (error) {
			errors.push(error);
		}
		throwCallbackErrors(errors, "Errors occurred while updating Descriptor");
	}

	destroy() {
		if (this.ownership.kind === "destroyed") return;

		if (this.ownership.kind === "admitting") {
			this.ownership.lease.cancel();
			return;
		}

		const { unlink } = this.ownership;
		this.ownership = { kind: "destroyed" };

		unlink();
		this.host.uninstallDescriptor(this.instance);
		this.cleanupBinding();

		this.updateCallbacks.clear();
		const errors = this.destroyCallbacks.emit(this.instance);
		this.destroyCallbacks.clear();
		try {
			this.host.announceDestroyed(this.instance);
		} catch (error) {
			errors.push(error);
		}
		throwCallbackErrors(errors, "Errors occurred while destroying Descriptor");
	}

	onUpdate(callback: (self: Descriptor<TDescriptorData, TSourceData>) => void): Disconnect {
		if (this.ownership.kind === "destroyed") return () => {};
		return this.updateCallbacks.add(callback);
	}

	onDestroy(callback: (self: Descriptor<TDescriptorData, TSourceData>) => void): Disconnect {
		if (this.ownership.kind === "destroyed") return () => {};
		return this.destroyCallbacks.add(callback);
	}

	private assertAlive() {
		if (this.ownership.kind === "destroyed") throw new Error("Descriptor has been destroyed");
	}

	private isInactive() {
		return (
			this.ownership.kind === "destroyed" ||
			(this.ownership.kind === "admitting" && this.ownership.lease.isTerminal())
		);
	}

	private cleanupBinding() {
		try {
			this.binding?.destroy();
		} finally {
			this.derivedSources.forEach((source) => source.destroy());
			this.derivedSources.length = 0;
		}
	}
}

export class DescriptorInstance<TDescriptorData, TSourceData> implements Descriptor<
	TDescriptorData,
	TSourceData
> {
	public readonly id: number;
	public readonly type: DescriptorType<TDescriptorData, TSourceData>;
	public readonly key: string | undefined;
	public readonly provenance: StateProvenance;

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
