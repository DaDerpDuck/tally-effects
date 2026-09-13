import { ModifierRegistry, type ModifierHandle } from "../modifier/ModifierRegistry.js";
import { OrderingDomain } from "../modifier/OrderingDomain.js";
import type { AnyProperty, Property } from "../property/Property.js";
import type { AdmissionCoordinator } from "../state/AdmissionCoordinator.js";
import type { AdmissionPlan } from "../state/AdmissionPlan.js";
import type { StateProvenance } from "../state/Provenance.js";
import type { Source } from "../state/source/Source.js";
import type { SourceContribution } from "../state/source/SourceContribution.js";
import { SourceRuntime, type SourceHost } from "../state/source/SourceInstance.js";
import type { SourceOption } from "../state/source/SourceOption.js";
import { SourceType, type AnySourceType } from "../state/source/SourceType.js";
import { CallbackSet, throwCallbackErrors } from "../util/CallbackSet.js";
import type { Disconnect } from "../util/Disconnect.js";
import { getOrInsertComputed } from "../util/GetOrInsert.js";
import type { IdCounter } from "../util/IdCounter.js";

export type PropertyCallback<T = unknown> = (newValue: T, oldValue: T) => void;
export type SourceCallback<T = unknown> = (source: Source<T>) => void;

export class SourceManager {
	private static readonly EmptySet: ReadonlySet<unknown> = new Set();

	private readonly modifierRegistry = new ModifierRegistry();
	private readonly sources = new Set<Source>();
	private readonly sourceMap = new Map<AnySourceType, Set<Source>>();

	private readonly propertyCallbacks = new Map<AnyProperty, CallbackSet<[unknown, unknown]>>();
	private readonly sourceAddedCallbacks = new CallbackSet<[source: Source]>();
	private readonly sourceRemovedCallbacks = new CallbackSet<[source: Source]>();
	private readonly sourceUpdatedCallbacks = new CallbackSet<[source: Source]>();

	private readonly resolvedProperties = new Map<AnyProperty, unknown>();
	private readonly dirtyProperties = new Set<AnyProperty>();

	private mutationDepth = 0;

	constructor(
		private readonly counter: IdCounter,
		private readonly admission: AdmissionCoordinator
	) {}

	addSource<TData>(
		type: SourceType<TData>,
		data: TData,
		options?: SourceOption
	): Source<TData> | undefined {
		const announce = this.batch(() => {
			return this.admission.admit(this.planSource(type, data, options));
		});
		return announce?.();
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
			if (this.mutationDepth === 0) this.resolveProperties();
		}
	}

	onPropertyChanged<T>(property: Property<T>, callback: PropertyCallback<T>): Disconnect {
		let callbacks = this.propertyCallbacks.get(property);
		if (!callbacks) {
			callbacks = new CallbackSet<[unknown, unknown]>();
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
					this.createHost(type)
				);
			},
		};
	}

	private createHost<TData>(type: SourceType<TData>): SourceHost<TData> {
		return {
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

				for (const handle of oldHandles) this.dirtyProperties.add(handle.property);
				for (const handle of newHandles) this.dirtyProperties.add(handle.property);
				
				this.clearModifierHandles(oldHandles);

				return newHandles;
			},
			resolveModifiers: () => {
				this.requestResolve();
			},
			installSource: (source, handles) => {
				this.sources.add(source);
				for (const handle of handles) this.dirtyProperties.add(handle.property);

				getOrInsertComputed(this.sourceMap, type, () => new Set()).add(source);
			},
			uninstallSource: (source, handles) => {
				for (const handle of handles) this.dirtyProperties.add(handle.property);
				this.clearModifierHandles(handles);
				this.sources.delete(source);
				this.sourceMap.get(source.type)?.delete(source);
			},
			announceAdded: (source) =>
				throwCallbackErrors(
					this.sourceAddedCallbacks.emit(source),
					"Errors occurred while announcing Source addition"
				),
			announceUpdated: (source) =>
				throwCallbackErrors(
					this.sourceUpdatedCallbacks.emit(source),
					"Errors occurred while announcing Source update"
				),
			announceDestroyed: (source) =>
				throwCallbackErrors(
					this.sourceRemovedCallbacks.emit(source),
					"Errors occurred while announcing Source destruction"
				),
		};
	}

	private requestResolve() {
		if (this.mutationDepth === 0) this.resolveProperties();
	}

	private resolveProperties() {
		for (const property of this.dirtyProperties) {
			const newResolution = property.resolve(
				property.defaultValue,
				this.modifierRegistry.get(property)
			);
			const oldResolution = this.get(property);
			this.resolvedProperties.set(property, newResolution);
			if (!property.valueEquals(oldResolution, newResolution)) {
				const callbacks = this.propertyCallbacks.get(property);
				if (callbacks)
					throwCallbackErrors(
						callbacks.emit(newResolution, oldResolution),
						"Errors occurred while announcing property change"
					);
			}
		}
		this.dirtyProperties.clear();
	}

	private contributeModifiers<TData>(type: SourceType<TData>, data: TData): SourceContribution {
		return type.contribute(data);
	}

	private applyModifiers(
		contribution: SourceContribution,
		priority: number,
		provenance: StateProvenance
	): ModifierHandle[] {
		return contribution.map((modifier, index) =>
			modifier.applyTo(this.modifierRegistry, {
				priority,
				domain:
					provenance.domain === "local" || provenance.domain === "descriptor-local"
						? OrderingDomain.local
						: OrderingDomain.authoritative,
				sequence: provenance.sequence,
				modifierIndex: index,
			})
		);
	}

	private clearModifierHandles(handles: ModifierHandle[]) {
		for (const handle of handles) this.modifierRegistry.delete(handle);
		handles.length = 0;
	}
}
