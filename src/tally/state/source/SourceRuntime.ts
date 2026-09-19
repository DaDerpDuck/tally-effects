import type { ModifierHandle } from "../../modifier/ModifierRegistry.js";
import type { Disconnect } from "../../util/Disconnect.js";
import { CallbackSet } from "../../util/CallbackSet.js";
import type { AdmissionRuntime, RuntimeOwnership } from "../AdmissionRuntime.js";
import type { AdmissionLease } from "../AdmissionTransaction.js";
import type { Source } from "./Source.js";
import type { SourceContribution } from "./SourceContribution.js";
import { SourceInstance, type SourceIdentity } from "./SourceInstance.js";
import type { SourceType } from "./SourceType.js";
import type { TallyReporter } from "../../core/TallyReporter.js";

export interface SourceHost {
	getReporter(): TallyReporter;
	contributeModifiers<TData>(type: SourceType<TData>, data: TData): SourceContribution;
	applyModifiers<TData>(
		contributions: SourceContribution,
		source: SourceInstance<TData>
	): ModifierHandle[];
	discardModifiers(handles: ModifierHandle[]): void;
	changeModifiers<TData>(
		source: SourceInstance<TData>,
		oldHandles: ModifierHandle[],
		newContributions: SourceContribution
	): ModifierHandle[];
	resolveModifiers(): void;
	installSource<TData>(source: SourceInstance<TData>, handles: ModifierHandle[]): void;
	uninstallSource<TData>(source: SourceInstance<TData>, handles: ModifierHandle[]): void;
	announceAdded<TData>(source: SourceInstance<TData>): void;
	announceUpdated<TData>(source: SourceInstance<TData>): void;
	announceDestroyed<TData>(source: SourceInstance<TData>): void;
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
	private readonly updateCallbacks: CallbackSet<[self: Source<TData>]>;
	private readonly destroyCallbacks: CallbackSet<[self: Source<TData>]>;
	private ownership: RuntimeOwnership;
	private data: TData;
	private pendingData: TData | undefined;
	private hasPendingData = false;
	private updating = false;
	private contributions: SourceContribution | undefined;
	private handles: ModifierHandle[] = [];
	private installed = false;
	private announced = false;

	constructor(
		lease: AdmissionLease,
		identity: SourceIdentity<TData>,
		private readonly host: SourceHost
	) {
		this.type = identity.type;
		this.data = identity.data;
		this.ownership = {
			kind: "admitting",
			lease,
		};
		this.instance = new SourceInstance(identity, this);

		const reporter = host.getReporter();
		this.updateCallbacks = new CallbackSet(reporter, (source) => ({
			operation: "update",
			event: "source-updated",
			subject: { kind: "source", type: source.type.name, id: source.id },
		}));
		this.destroyCallbacks = new CallbackSet(reporter, (source) => ({
			operation: "destroy",
			event: "source-removed",
			subject: { kind: "source", type: source.type.name, id: source.id },
		}));
	}

	prepare(): void {
		if (this.ownership.kind !== "admitting")
			throw new Error("Cannot prepare a non-admitting runtime");
		const lease = this.ownership.lease;
		while (!lease.isTerminal()) {
			if (this.hasPendingData) {
				this.data = this.pendingData!;
				this.pendingData = undefined;
				this.hasPendingData = false;
			}

			const contributions = this.host.contributeModifiers(this.type, this.data);
			if (lease.isTerminal()) return;

			if (this.hasPendingData) continue;

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
		this.host.resolveModifiers();
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
		if (this.announced) {
			this.destroyCallbacks.emit(this.instance);
			this.host.announceDestroyed(this.instance);
		}
		this.destroyCallbacks.clear();
	}

	get(): TData {
		return this.data;
	}

	set(data: TData): void {
		this.assertAlive();
		const currentData = this.hasPendingData ? this.pendingData! : this.data;
		if (this.type.dataEquals(currentData, data)) return;

		this.pendingData = data;
		this.hasPendingData = true;
		if (!this.installed || this.updating) return;

		this.drainPendingUpdates();
	}

	private drainPendingUpdates() {
		let committedData = this.data;
		let committedContributions = this.contributions;
		try {
			this.updating = true;
			do {
				const nextData = this.pendingData!;
				this.pendingData = undefined;
				this.hasPendingData = false;

				if (this.type.dataEquals(this.data, nextData)) continue;

				this.data = nextData;

				const nextContributions = this.host.contributeModifiers(this.type, this.data);
				if (this.isInactive()) return;
				if (this.hasPendingData) continue;

				this.handles = this.host.changeModifiers(
					this.instance,
					this.handles,
					nextContributions
				);
				this.contributions = nextContributions;
				committedData = this.data;
				committedContributions = nextContributions;

				this.host.resolveModifiers();

				if (this.isInactive()) return;
				if (this.hasPendingData) continue;
				this.updateCallbacks.emit(this.instance);

				if (this.isInactive()) return;
				if (this.hasPendingData) continue;
				this.host.announceUpdated(this.instance);
			} while (!this.isInactive() && this.hasPendingData);
		} catch (error) {
			if (!this.isInactive()) {
				this.data = committedData;
				this.contributions = committedContributions;
			}
			this.pendingData = undefined;
			this.hasPendingData = false;
			throw error;
		} finally {
			this.updating = false;
		}
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

		this.host.resolveModifiers();

		this.updateCallbacks.clear();
		this.destroyCallbacks.emit(this.instance);
		this.destroyCallbacks.clear();
		this.host.announceDestroyed(this.instance);
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
