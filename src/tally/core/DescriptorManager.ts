import type { AnyDescriptor, Descriptor } from "../state/descriptor/Descriptor.js";
import type { DescriptorBinding } from "../state/descriptor/DescriptorBinding.js";
import type {
	AnyDescriptorHandler,
	DescriptorHandler,
} from "../state/descriptor/DescriptorHandler.js";
import { DescriptorInstance } from "../state/descriptor/DescriptorInstance.js";
import type { DescriptorOption } from "../state/descriptor/DescriptorOption.js";
import type { AnyDescriptorType, DescriptorType } from "../state/descriptor/DescriptorType.js";
import { PlannedDescriptor } from "../state/descriptor/PlannedDescriptor.js";
import type { DuplicationResolver } from "../state/duplication/DuplicationResolver.js";
import type { PlannedInstance } from "../state/PlannedInstance.js";
import type { Source } from "../state/source/Source.js";
import type { SourceOption } from "../state/source/SourceOption.js";
import type { Disconnect } from "../util/Disconnect.js";
import { getOrInsertComputed } from "../util/GetOrInsert.js";
import type { IdCounter } from "../util/IdCounter.js";
import type { AgentState } from "./AgentState.js";
import type { SourceManager } from "./SourceManager.js";

export type DescriptorCallback<TDescriptorData = unknown, TSourceData = unknown> = (
	descriptor: Descriptor<TDescriptorData, TSourceData>
) => void;

export class DescriptorManager<TEntity> {
	private static readonly EmptySet: ReadonlySet<unknown> = new Set();

	private readonly descriptorHandlers = new Map<AnyDescriptorType, AnyDescriptorHandler>();
	private readonly descriptorMap = new Map<AnyDescriptorType, Set<AnyDescriptor>>();

	private readonly descriptorAddedCallbacks = new Set<DescriptorCallback>();
	private readonly descriptorRemovedCallbacks = new Set<DescriptorCallback>();
	private readonly descriptorUpdatedCallbacks = new Set<DescriptorCallback>();

	constructor(
		private readonly counter: IdCounter,
		private readonly duplicationResolver: DuplicationResolver,
		private readonly sources: SourceManager
	) {}

	addDescriptor<TDescriptorData, TSourceData>(
		agent: AgentState<TEntity>,
		type: DescriptorType<TDescriptorData, TSourceData>,
		data: TDescriptorData,
		options?: DescriptorOption
	): Descriptor<TDescriptorData, TSourceData> | undefined {
		const result = this.sources.batch(() =>
			this.duplicationResolver.resolve(
				() => this.prepareDescriptor(agent, type, data, options),
				type,
				data,
				options?.key
			)
		);

		if (result.result === "added") {
			result.instance.onDestroy(() => result.unregister());
			result.publish();
			return result.instance;
		} else {
			return undefined;
		}
	}

	registerDescriptorHandler<TDescriptorData, TSourceData>(
		type: DescriptorType<TDescriptorData, TSourceData>,
		handler: DescriptorHandler<TEntity, TDescriptorData, TSourceData>
	) {
		this.descriptorHandlers.set(type, handler as AnyDescriptorHandler);
	}

	getDescriptors(
		type?: DescriptorType<unknown, unknown>
	): ReadonlySet<Descriptor<unknown, unknown>> {
		if (type === undefined)
			return new Set(this.descriptorMap.values().flatMap((x) => x.values().toArray()));
		return (this.descriptorMap.get(type) ?? DescriptorManager.EmptySet) as ReadonlySet<
			Descriptor<unknown, unknown>
		>;
	}

	onDescriptorAdded(callback: DescriptorCallback): Disconnect {
		this.descriptorAddedCallbacks.add(callback);
		return () => this.descriptorAddedCallbacks.delete(callback);
	}

	onDescriptorRemoved(callback: DescriptorCallback): Disconnect {
		this.descriptorRemovedCallbacks.add(callback);
		return () => this.descriptorRemovedCallbacks.delete(callback);
	}

	onDescriptorUpdated(callback: DescriptorCallback): Disconnect {
		this.descriptorUpdatedCallbacks.add(callback);
		return () => this.descriptorUpdatedCallbacks.delete(callback);
	}

	destroyAllDescriptors() {
		this.descriptorMap
			.values()
			.forEach((descriptors) => descriptors.forEach((x) => x.destroy()));
		this.descriptorMap.clear();
	}

	disconnectAll() {
		this.descriptorAddedCallbacks.clear();
		this.descriptorRemovedCallbacks.clear();
		this.descriptorUpdatedCallbacks.clear();
	}

	private prepareDescriptor<TDescriptorData, TSourceData>(
		agent: AgentState<TEntity>,
		type: DescriptorType<TDescriptorData, TSourceData>,
		data: TDescriptorData,
		options?: DescriptorOption
	): PlannedDescriptor<TDescriptorData, TSourceData> | undefined {
		const handler = this.descriptorHandlers.get(type);
		if (!handler)
			throw new Error(
				"Attempted to add a descriptor source before a descriptor handler was assigned"
			);

		return new PlannedDescriptor({
			createDescriptor: () => this.createDescriptor(agent, handler, type, data, options),
			installDescriptor: (descriptor) => {
				getOrInsertComputed(this.descriptorMap, type, () => new Set()).add(descriptor);

				descriptor.onUpdate(() => {
					this.descriptorUpdatedCallbacks.forEach((callback) => callback(descriptor));
				});

				descriptor.onDestroy(() => {
					this.descriptorMap.get(type)?.delete(descriptor);
				});
			},
			publish: (descriptor) => {
				descriptor.onDestroy(() => {
					this.descriptorRemovedCallbacks.forEach((callback) => callback(descriptor));
				});
				this.descriptorAddedCallbacks.forEach((callback) => callback(descriptor));
			},
		});
	}

	private createDescriptor<TDescriptorData, TSourceData>(
		agent: AgentState<TEntity>,
		handler: AnyDescriptorHandler,
		type: DescriptorType<TDescriptorData, TSourceData>,
		data: TDescriptorData,
		options?: DescriptorOption
	) {
		// Reserve id before handler is called.
		const descriptorId = this.counter.next();

		const provenance = options?.provenance ?? {
			domain: "local",
			sequence: descriptorId,
		};

		const bindingProvider = (
			derivedSources: Source[]
		): DescriptorBinding<TDescriptorData, TSourceData> =>
			handler(
				{
					agent,
					addSource: (data, options) => {
						const newOptions: SourceOption = {
							provenance: {
								domain:
									provenance.domain === "local"
										? "descriptor-local"
										: "descriptor-replicated",
								sequence: provenance.sequence,
							},
							...options,
						};
						const source = this.sources.addSource(type.source, data, newOptions);
						if (source) derivedSources.push(source);
						return source;
					},
				},
				data
			) as DescriptorBinding<TDescriptorData, TSourceData>;

		const descriptor = new DescriptorInstance<TDescriptorData, TSourceData>(
			descriptorId,
			type,
			options?.key,
			provenance,
			bindingProvider,
			data
		);

		return descriptor;
	}
}
