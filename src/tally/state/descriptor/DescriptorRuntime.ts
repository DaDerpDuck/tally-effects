import { tallyReport, type TallyReporter } from "../../core/TallyReporter.js";
import { CallbackSet } from "../../util/CallbackSet.js";
import type { Disconnect } from "../../util/Disconnect.js";
import type { AdmissionRuntime, RuntimeOwnership } from "../AdmissionRuntime.js";
import type { AdmissionLease } from "../AdmissionTransaction.js";
import type { Source } from "../source/Source.js";
import type { Descriptor } from "./Descriptor.js";
import type { DescriptorBinding } from "./DescriptorBinding.js";
import { DescriptorInstance, type DescriptorIdentity } from "./DescriptorInstance.js";
import type { DescriptorType } from "./DescriptorType.js";

export interface DescriptorHost<TDescriptorData, TSourceData> {
	getReporter(): TallyReporter;
	tryBind(derivedSources: Source[]): DescriptorBinding<TDescriptorData, TSourceData> | undefined;
	installDescriptor(descriptor: DescriptorInstance<TDescriptorData, TSourceData>): void;
	uninstallDescriptor(descriptor: DescriptorInstance<TDescriptorData, TSourceData>): void;
	announceAdded(source: DescriptorInstance<TDescriptorData, TSourceData>): void;
	announceUpdated(source: DescriptorInstance<TDescriptorData, TSourceData>): void;
	announceDestroyed(source: DescriptorInstance<TDescriptorData, TSourceData>): void;
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
	private readonly updateCallbacks: CallbackSet<[self: Descriptor<TDescriptorData, TSourceData>]>;
	private readonly destroyCallbacks: CallbackSet<
		[self: Descriptor<TDescriptorData, TSourceData>]
	>;
	private ownership: RuntimeOwnership;
	private binding: DescriptorBinding<TDescriptorData, TSourceData> | undefined;
	private data: TDescriptorData;
	private dataRevision = 0;
	private updating = false;
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

		const reporter = host.getReporter();
		this.updateCallbacks = new CallbackSet(
			reporter,
			{
				operation: "update",
				event: "descriptor-updated",
			},
			(descriptor) => ({
				subject: { kind: "descriptor", type: descriptor.type.name, id: descriptor.id },
			})
		);
		this.destroyCallbacks = new CallbackSet(
			reporter,
			{
				operation: "destroy",
				event: "descriptor-removed",
			},
			(descriptor) => ({
				subject: { kind: "descriptor", type: descriptor.type.name, id: descriptor.id },
			})
		);
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

		if (this.announced) {
			this.destroyCallbacks.emit(this.instance);
			this.host.announceDestroyed(this.instance);
		}

		this.destroyCallbacks.clear();
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
		this.dataRevision++;
		if (this.updating) return;

		try {
			this.updating = true;
			while (!this.isInactive()) {
				const revision = this.dataRevision;
				this.binding?.update(this.data);
				if (this.isInactive()) return;
				if (this.dataRevision !== revision) continue;
				break;
			}

			if (this.isInactive()) return;
			this.updateCallbacks.emit(this.instance);

			if (this.isInactive()) return;
			this.host.announceUpdated(this.instance);
		} finally {
			this.updating = false;
		}
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
		this.destroyCallbacks.emit(this.instance);
		this.destroyCallbacks.clear();
		this.host.announceDestroyed(this.instance);
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
		} catch (error) {
			tallyReport(this.host.getReporter(), {
				code: "binding-cleanup-failed",
				operation: "destroy",
				error,
			});
		}

		for (let i = 0; i < this.derivedSources.length; i++) {
			try {
				this.derivedSources[i]!.destroy();
			} catch (error) {
				tallyReport(this.host.getReporter(), {
					code: "derived-source-cleanup-failed",
					operation: "destroy",
					error,
				});
			}
		}
		this.derivedSources.length = 0;
	}
}
