import type { AnyDescriptor, Descriptor } from "../state/descriptor/Descriptor.js";
import type { DescriptorBinding } from "../state/descriptor/DescriptorBinding.js";
import type {
	AnyDescriptorHandler,
	DescriptorHandler,
} from "../state/descriptor/DescriptorHandler.js";
import { DescriptorInstance } from "../state/descriptor/DescriptorInstance.js";
import type { DescriptorOption } from "../state/descriptor/DescriptorOption.js";
import type { AnyDescriptorType, DescriptorType } from "../state/descriptor/DescriptorType.js";
import type { DuplicationResolver } from "../state/duplication/DuplicationResolver.js";
import type { PlannedInstance } from "../state/PlannedInstance.js";
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
		const preparedDescriptor = this.prepareDescriptor(agent, type, data, options);
		if (!preparedDescriptor) return undefined;
		const result = this.sources.batch(() =>
			this.duplicationResolver.resolve(preparedDescriptor, type, data, options?.key)
		);

		if (result.result === "added") {
			result.instance.onDestroy(() => result.unregister());
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
	): PlannedInstance<Descriptor<TDescriptorData, TSourceData>> | undefined {
		const handler = this.descriptorHandlers.get(type);
		if (!handler)
			throw new Error(
				"Attempted to add a descriptor source before a descriptor handler was assigned"
			);

		let descriptorOptional: DescriptorInstance<TDescriptorData, TSourceData> | undefined;
		const getInstance = (): DescriptorInstance<TDescriptorData, TSourceData> => {
			if (descriptorOptional) return descriptorOptional;

			// Reserve id before handler is called.
			const descriptorId = this.counter.next();

			const provenance = options?.provenance ?? {
				domain: "local",
				sequence: descriptorId,
			};

			const bindingProvider = (): DescriptorBinding<TDescriptorData, TSourceData> =>
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
							return this.sources.addSource(type.source, data, newOptions);
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

			descriptorOptional = descriptor;
			return descriptor;
		};

		return {
			get: getInstance,
			publish: () => {
				const descriptor = getInstance();
				if (!descriptor.tryBind()) return undefined;

				getOrInsertComputed(this.descriptorMap, type, () => new Set()).add(descriptor);
				this.descriptorAddedCallbacks.forEach((callback) => callback(descriptor));

				descriptor.onUpdate(() =>
					this.descriptorUpdatedCallbacks.forEach((callback) => callback(descriptor))
				);

				descriptor.onDestroy(() => {
					this.descriptorMap.get(type)?.delete(descriptor);
					this.descriptorRemovedCallbacks.forEach((callback) => callback(descriptor));
				});

				return descriptor;
			},
			cancel: () => {
				descriptorOptional?.destroy();
			},
		};
	}
}
