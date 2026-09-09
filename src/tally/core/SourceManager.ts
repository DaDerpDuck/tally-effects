import { ModifierRegistry, type ModifierHandle } from "../modifier/ModifierRegistry.js";
import { OrderingDomain } from "../modifier/OrderingDomain.js";
import type { AnyProperty, Property } from "../property/Property.js";
import type { DuplicationResolver, DuplicationResult } from "../state/duplication/DuplicationResolver.js";
import type { PlannedInstance } from "../state/PlannedInstance.js";
import type { StateProvenance } from "../state/Provenance.js";
import { PlannedSource } from "../state/source/PlannedSource.js";
import type { Source } from "../state/source/Source.js";
import { SourceInstance } from "../state/source/SourceInstance.js";
import type { SourceOption } from "../state/source/SourceOption.js";
import { SourceType, type AnySourceType } from "../state/source/SourceType.js";
import type { Disconnect } from "../util/Disconnect.js";
import { getOrInsertComputed } from "../util/GetOrInsert.js";
import type { IdCounter } from "../util/IdCounter.js";

export type PropertyCallback<T = unknown> = (newValue: T, oldValue: T) => void;
export type SourceCallback<T = unknown> = (source: Source<T>) => void;

export class SourceManager {
	private static readonly EmptySet: ReadonlySet<unknown> = new Set();

	private readonly modifierRegistry = new ModifierRegistry();
	private readonly sourceModifiersMap = new Map<Source, readonly ModifierHandle[]>();
	private readonly sourceMap = new Map<AnySourceType, Set<Source>>();

	private readonly propertyCallbacks = new Map<AnyProperty, Set<PropertyCallback>>();
	private readonly sourceAddedCallbacks = new Set<SourceCallback>();
	private readonly sourceRemovedCallbacks = new Set<SourceCallback>();
	private readonly sourceUpdatedCallbacks = new Set<SourceCallback>();

	private readonly resolvedProperties = new Map<AnyProperty, unknown>();
	private readonly dirtyProperties = new Set<AnyProperty>();

	private mutationDepth = 0;

	constructor(
		private readonly counter: IdCounter,
		private readonly duplicationResolver: DuplicationResolver
	) {}

	addSource<TData>(
		type: SourceType<TData>,
		data: TData,
		options?: SourceOption
	): Source<TData> | undefined {
		let result: DuplicationResult<Source<TData>, TData>
		// inlined batch
		this.mutationDepth++;
		try {
			result = this.duplicationResolver.resolve(
				() => this.prepareSource(type, data, options),
				type,
				data,
				options?.key
			);
		} finally {
			this.mutationDepth--;
			if (this.mutationDepth === 0) this.resolveProperties();
		}

		if (result.result === "added") {
			result.instance.onDestroy(() => result.unregister());
			result.publish();
			return result.instance;
		} else {
			return undefined;
		}
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
		if (type === undefined) return new Set(this.sourceModifiersMap.keys());
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
		if (callbacks) {
			callbacks.add(callback as PropertyCallback<unknown>);
		} else {
			callbacks = new Set();
			this.propertyCallbacks.set(property, callbacks);
			callbacks.add(callback as PropertyCallback<unknown>);
		}

		return () => callbacks.delete(callback as PropertyCallback<unknown>);
	}

	onSourceAdded(callback: SourceCallback): Disconnect {
		this.sourceAddedCallbacks.add(callback);
		return () => this.sourceAddedCallbacks.delete(callback);
	}

	onSourceRemoved(callback: SourceCallback): Disconnect {
		this.sourceRemovedCallbacks.add(callback);
		return () => this.sourceRemovedCallbacks.delete(callback);
	}

	onSourceUpdated(callback: SourceCallback): Disconnect {
		this.sourceUpdatedCallbacks.add(callback);
		return () => this.sourceUpdatedCallbacks.delete(callback);
	}

	disconnectAll() {
		this.propertyCallbacks.clear();
		this.sourceAddedCallbacks.clear();
		this.sourceRemovedCallbacks.clear();
		this.sourceUpdatedCallbacks.clear();
	}

	destroyAllSources() {
		this.batch(() => this.sourceModifiersMap.forEach((_, source) => source.destroy()));
		this.sourceModifiersMap.clear();
		this.modifierRegistry.clear();
		this.resolvedProperties.clear();
		this.dirtyProperties.clear();
	}

	private prepareSource<TData>(
		type: SourceType<TData>,
		data: TData,
		options?: SourceOption
	): PlannedSource<TData> {
		return new PlannedSource({
			createSource: () => this.createSource(type, data, options),
			applyModifiers: (source) =>
				this.applyModifiers(type, source.priority, source.provenance, data),
			discardModifiers: (handles) => this.clearModifierHandles(handles),
			installSource: (source, handles) => {
				this.sourceModifiersMap.set(source, handles);
				for (const handle of handles) this.dirtyProperties.add(handle.property);
				this.requestResolve();

				getOrInsertComputed(this.sourceMap, type, () => new Set()).add(source);

				let isDestroyed = false;
				source.onUpdate(() => {
					for (const handle of handles) this.dirtyProperties.add(handle.property);
					this.clearModifierHandles(handles);
					const nextHandles = this.applyModifiers(
						type,
						source.priority,
						source.provenance,
						source.get()
					);
					// reentrant code may have destroyed this source
					if (isDestroyed) {
						this.clearModifierHandles(nextHandles);
						return;
					}
					handles = nextHandles;
					this.sourceModifiersMap.set(source, handles);
					for (const handle of handles) this.dirtyProperties.add(handle.property);
					this.requestResolve();
					this.sourceUpdatedCallbacks.forEach((callback) => callback(source));
				});

				source.onDestroy(() => {
					isDestroyed = true;
					for (const handle of handles) this.dirtyProperties.add(handle.property);
					this.clearModifierHandles(handles);
					this.sourceModifiersMap.delete(source);
					this.sourceMap.get(source.type)?.delete(source);
					this.requestResolve();
				});
			},
			publish: (source) => {
				source.onDestroy(() =>
					this.sourceRemovedCallbacks.forEach((callback) => callback(source))
				);
				this.sourceAddedCallbacks.forEach((callback) => callback(source));
			},
		});
	}

	private createSource<TData>(type: SourceType<TData>, data: TData, options?: SourceOption) {
		const priority = options?.priority ?? type.priority;
		const sourceId = this.counter.next();
		const provenance = options?.provenance ?? {
			domain: "local",
			sequence: sourceId,
		};
		const source = new SourceInstance(sourceId, type, priority, options?.key, provenance, data);
		return source;
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
				callbacks?.forEach((callback) => callback(newResolution, oldResolution));
			}
		}
		this.dirtyProperties.clear();
	}

	private applyModifiers<TData>(
		type: SourceType<TData>,
		priority: number,
		provenance: StateProvenance,
		data: TData
	): ModifierHandle[] {
		return type.contribute(data).map((modifier, index) =>
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
