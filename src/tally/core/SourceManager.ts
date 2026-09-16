import { ModifierRegistry, type ModifierHandle } from "../modifier/ModifierRegistry.js";
import { OrderingDomain } from "../modifier/OrderingDomain.js";
import type { AnyProperty, Property } from "../property/Property.js";
import type { AdmissionCoordinator, AdmissionReceipt } from "../state/AdmissionCoordinator.js";
import type { AdmissionPlan } from "../state/AdmissionPlan.js";
import type { StateProvenance } from "../state/Provenance.js";
import type { Source } from "../state/source/Source.js";
import type { SourceContribution } from "../state/source/SourceContribution.js";
import type { SourceOption } from "../state/source/SourceOption.js";
import { SourceRuntime, type SourceHost } from "../state/source/SourceRuntime.js";
import { SourceType, type AnySourceType } from "../state/source/SourceType.js";
import { CallbackSet } from "../util/CallbackSet.js";
import type { Disconnect } from "../util/Disconnect.js";
import { getOrInsertComputed } from "../util/GetOrInsert.js";
import type { IdCounter } from "../util/IdCounter.js";
import { tallyReport, type TallyReporter } from "./TallyReporter.js";

export type PropertyCallback<T = unknown> = (newValue: T, oldValue: T) => void;
export type SourceCallback<T = unknown> = (source: Source<T>) => void;

export class SourceManager {
	private static readonly EmptySet: ReadonlySet<unknown> = new Set();

	private readonly modifierRegistry = new ModifierRegistry();
	private readonly sources = new Set<Source>();
	private readonly sourceMap = new Map<AnySourceType, Set<Source>>();
	private readonly sourceHost = this.createHost();

	private readonly propertyCallbacks = new Map<AnyProperty, CallbackSet<[unknown, unknown]>>();
	private readonly sourceAddedCallbacks: CallbackSet<[source: Source]>;
	private readonly sourceRemovedCallbacks: CallbackSet<[source: Source]>;
	private readonly sourceUpdatedCallbacks: CallbackSet<[source: Source]>;

	private readonly resolvedProperties = new Map<AnyProperty, unknown>();
	private readonly dirtyProperties = new Set<AnyProperty>();
	private mutationDepth = 0;

	constructor(
		private readonly reporter: TallyReporter,
		private readonly counter: IdCounter,
		private readonly admission: AdmissionCoordinator
	) {
		this.sourceAddedCallbacks = new CallbackSet(reporter, (source) => ({
			operation: "admit",
			event: "source-added",
			subject: { kind: "source", type: source.type.name, id: source.id },
		}));
		this.sourceRemovedCallbacks = new CallbackSet(reporter, (source) => ({
			operation: "destroy",
			event: "source-removed",
			subject: { kind: "source", type: source.type.name, id: source.id },
		}));
		this.sourceUpdatedCallbacks = new CallbackSet(reporter, (source) => ({
			operation: "update",
			event: "source-updated",
			subject: { kind: "source", type: source.type.name, id: source.id },
		}));
	}

	addSource<TData>(
		type: SourceType<TData>,
		data: TData,
		options?: SourceOption
	): Source<TData> | undefined {
		let receipt: AdmissionReceipt<Source<TData>> | undefined;
		try {
			this.batch(
				() => (receipt = this.admission.admit(this.planSource(type, data, options)))
			);
		} catch (e) {
			const errors = [e];
			try {
				if (receipt) this.batch(() => receipt!.rollback());
			} catch (e2) {
				errors.push(e2);
			}
			if (errors.length === 1) throw errors[0];
			else throw new AggregateError(errors, "Failed to batch properties", { cause: e });
		}
		return this.batch(() => receipt?.publish());
	}

	get<T>(property: Property<T>): T {
		if (this.resolvedProperties.has(property))
			return this.resolvedProperties.get(property) as T;
		return property.defaultValue;
	}

	hasSource(type: SourceType<unknown>): boolean {
		const existingSource = this.sourceMap.get(type)?.values().next().value;
		return existingSource !== undefined;
	}

	getSources(type?: SourceType<unknown>): ReadonlySet<Source> {
		if (type === undefined) return this.sources;
		return (this.sourceMap.get(type) ?? SourceManager.EmptySet) as ReadonlySet<Source>;
	}

	batch<T>(callback: () => T): T {
		this.mutationDepth++;

		try {
			return callback();
		} finally {
			this.mutationDepth--;
			this.requestResolve();
		}
	}

	onPropertyChanged<T>(property: Property<T>, callback: PropertyCallback<T>): Disconnect {
		let callbacks = this.propertyCallbacks.get(property);
		if (!callbacks) {
			callbacks = new CallbackSet<[unknown, unknown]>(this.reporter, () => ({
				operation: "resolve",
				event: "property-changed",
				subject: {
					kind: "property",
					name: property.name,
				},
			}));
			this.propertyCallbacks.set(property, callbacks);
		}

		return callbacks.add(callback as PropertyCallback<unknown>);
	}

	onSourceAdded(callback: SourceCallback): Disconnect {
		return this.sourceAddedCallbacks.add(callback);
	}

	onSourceRemoved(callback: SourceCallback): Disconnect {
		return this.sourceRemovedCallbacks.add(callback);
	}

	onSourceUpdated(callback: SourceCallback): Disconnect {
		return this.sourceUpdatedCallbacks.add(callback);
	}

	disconnectAll() {
		this.propertyCallbacks.clear();
		this.sourceAddedCallbacks.clear();
		this.sourceRemovedCallbacks.clear();
		this.sourceUpdatedCallbacks.clear();
	}

	destroyAllSources() {
		this.batch(() => this.sources.forEach((source) => source.destroy()));
		this.sources.clear();
		this.modifierRegistry.clear();
		this.resolvedProperties.clear();
		this.dirtyProperties.clear();
	}

	private planSource<TData>(
		type: SourceType<TData>,
		data: TData,
		options?: SourceOption
	): AdmissionPlan<TData, Source<TData>, SourceRuntime<TData>> {
		return {
			type,
			key: options?.key,
			data,
			createRuntime: (lease) => {
				const id = this.counter.next();
				const priority = options?.priority ?? type.priority;
				const key = options?.key;
				const provenance = options?.provenance ?? {
					domain: "local",
					sequence: id,
				};

				return new SourceRuntime(
					lease,
					{ id, type, priority, key, provenance, data },
					this.sourceHost
				);
			},
		};
	}

	private createHost(): SourceHost {
		return {
			getReporter: () => this.reporter,
			contributeModifiers: (type, data) => this.contributeModifiers(type, data),
			applyModifiers: (contributions, source) =>
				this.applyModifiers(contributions, source.priority, source.provenance),
			discardModifiers: (handles) => this.clearModifierHandles(handles),
			changeModifiers: (source, oldHandles, newContributions) => {
				const newHandles = this.applyModifiers(
					newContributions,
					source.priority,
					source.provenance
				);

				this.markDirty(oldHandles);
				this.markDirty(newHandles);

				this.clearModifierHandles(oldHandles);

				return newHandles;
			},
			resolveModifiers: () => {
				this.requestResolve();
			},
			installSource: (source, handles) => {
				this.sources.add(source);
				this.markDirty(handles);

				getOrInsertComputed(this.sourceMap, source.type, () => new Set()).add(source);
			},
			uninstallSource: (source, handles) => {
				this.markDirty(handles);
				this.clearModifierHandles(handles);
				this.sources.delete(source);
				this.sourceMap.get(source.type)?.delete(source);
			},
			announceAdded: (source) => this.sourceAddedCallbacks.emit(source),
			announceUpdated: (source) => this.sourceUpdatedCallbacks.emit(source),
			announceDestroyed: (source) => this.sourceRemovedCallbacks.emit(source),
		};
	}

	private markDirty(handles: readonly ModifierHandle[]) {
		for (const { property } of handles) {
			this.dirtyProperties.add(property);
		}
	}

	private requestResolve() {
		if (this.mutationDepth === 0) this.resolveProperties();
	}

	private resolveProperties() {
		for (const property of [...this.dirtyProperties]) {
			this.dirtyProperties.delete(property);
			// Resolution maintains a derived cache after source state has committed.
			// Failures are reported and retried after a later mutation.
			let newResolution: unknown;
			try {
				newResolution = property.resolve(
					property.defaultValue,
					this.modifierRegistry.get(property)
				);
			} catch (error) {
				this.dirtyProperties.add(property);
				tallyReport(this.reporter, {
					code: "property-resolution-failed",
					operation: "resolve",
					subject: {
						kind: "property",
						name: property.name,
					},
					error,
				});
				continue;
			}

			const oldResolution = this.get(property);
			let changed: boolean;
			try {
				changed = !property.valueEquals(oldResolution, newResolution);
			} catch (error) {
				this.dirtyProperties.add(property);
				tallyReport(this.reporter, {
					code: "property-equality-failed",
					operation: "resolve",
					subject: {
						kind: "property",
						name: property.name,
					},
					error,
				});
				continue;
			}

			this.resolvedProperties.set(property, newResolution);
			if (changed) {
				const callbacks = this.propertyCallbacks.get(property);
				if (callbacks) callbacks.emit(newResolution, oldResolution);
			}
		}
	}

	private contributeModifiers<TData>(type: SourceType<TData>, data: TData): SourceContribution {
		return type.contribute(data);
	}

	private applyModifiers(
		contribution: SourceContribution,
		priority: number,
		provenance: StateProvenance
	): ModifierHandle[] {
		const handles = new Array<ModifierHandle>(contribution.length);

		try {
			for (let i = 0; i < contribution.length; i++) {
				handles[i] = contribution[i]!.applyTo(this.modifierRegistry, {
					priority,
					domain:
						provenance.domain === "local" || provenance.domain === "descriptor-local"
							? OrderingDomain.local
							: OrderingDomain.authoritative,
					sequence: provenance.sequence,
					modifierIndex: i,
				});
			}

			return handles;
		} catch (e) {
			this.clearModifierHandles(handles.filter((x) => x !== undefined));
			throw e;
		}
	}

	private clearModifierHandles(handles: ModifierHandle[]) {
		for (const handle of handles) this.modifierRegistry.delete(handle);
		handles.length = 0;
	}
}
