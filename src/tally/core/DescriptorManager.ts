import type { AdmissionCoordinator } from "../state/AdmissionCoordinator.js";
import type { AdmissionPlan } from "../state/AdmissionPlan.js";
import type { AnyDescriptor, Descriptor } from "../state/descriptor/Descriptor.js";
import type { DescriptorBinding } from "../state/descriptor/DescriptorBinding.js";
import type {
	AnyDescriptorHandler,
	DescriptorHandler,
} from "../state/descriptor/DescriptorHandler.js";
import { DescriptorRuntime, type DescriptorHost } from "../state/descriptor/DescriptorInstance.js";
import type { DescriptorOption } from "../state/descriptor/DescriptorOption.js";
import type { AnyDescriptorType, DescriptorType } from "../state/descriptor/DescriptorType.js";
import type { StateProvenance } from "../state/Provenance.js";
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

type BindingProvider<TDescriptorData, TSourceData> = (
	derivedSources: Source[]
) => DescriptorBinding<TDescriptorData, TSourceData> | undefined;

export class DescriptorManager<TEntity> {
	private static readonly EmptySet: ReadonlySet<unknown> = new Set();

	private readonly descriptorHandlers = new Map<AnyDescriptorType, AnyDescriptorHandler>();
	private readonly descriptorMap = new Map<AnyDescriptorType, Set<AnyDescriptor>>();

	private readonly descriptorAddedCallbacks = new Set<DescriptorCallback>();
	private readonly descriptorRemovedCallbacks = new Set<DescriptorCallback>();
	private readonly descriptorUpdatedCallbacks = new Set<DescriptorCallback>();

	constructor(
		private readonly counter: IdCounter,
		private readonly admission: AdmissionCoordinator,
		private readonly sources: SourceManager
	) {}

	addDescriptor<TDescriptorData, TSourceData>(
		agent: AgentState<TEntity>,
		type: DescriptorType<TDescriptorData, TSourceData>,
		data: TDescriptorData,
		options?: DescriptorOption
	): Descriptor<TDescriptorData, TSourceData> | undefined {
		const handler = this.descriptorHandlers.get(type);
		if (!handler)
			throw new Error(
				"Attempted to add a descriptor before a descriptor handler was assigned"
			);

		const announce = this.sources.batch(() => {
			return this.admission.admit(
				this.planDescriptor(
					handler as DescriptorHandler<TEntity, TDescriptorData, TSourceData>,
					agent,
					type,
					data,
					options
				)
			);
		});
		return announce?.();
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

	private planDescriptor<TDescriptorData, TSourceData>(
		handler: DescriptorHandler<TEntity, TDescriptorData, TSourceData>,
		agent: AgentState<TEntity>,
		type: DescriptorType<TDescriptorData, TSourceData>,
		data: TDescriptorData,
		options?: DescriptorOption
	): AdmissionPlan<
		TDescriptorData,
		Descriptor<TDescriptorData, TSourceData>,
		DescriptorRuntime<TDescriptorData, TSourceData>
	> {
		return {
			type,
			key: options?.key,
			data,
			createRuntime: (lease) => {
				const id = this.counter.next();
				const key = options?.key;
				const provenance = options?.provenance ?? {
					domain: "local",
					sequence: id,
				};

				return new DescriptorRuntime(
					lease,
					{ id, type, key, provenance, data },
					this.createHost(
						type,
						this.createBindingProvider(handler, agent, type, data, provenance)
					)
				);
			},
		};
	}

	private createHost<TDescriptorData, TSourceData>(
		type: DescriptorType<TDescriptorData, TSourceData>,
		bindingProvider: BindingProvider<TDescriptorData, TSourceData>
	): DescriptorHost<TDescriptorData, TSourceData> {
		return {
			tryBind: (derivedSources) => bindingProvider(derivedSources),
			installDescriptor: (descriptor) => {
				getOrInsertComputed(this.descriptorMap, type, () => new Set()).add(descriptor);
			},
			uninstallDescriptor: (descriptor) => {
				this.descriptorMap.get(type)?.delete(descriptor);
			},
			announceAdded: (descriptor) =>
				this.descriptorAddedCallbacks.forEach((callback) => callback(descriptor)),
			announceUpdated: (descriptor) =>
				this.descriptorUpdatedCallbacks.forEach((callback) => callback(descriptor)),
			announceDestroyed: (descriptor) =>
				this.descriptorRemovedCallbacks.forEach((callback) => callback(descriptor)),
		};
	}

	private createBindingProvider<TDescriptorData, TSourceData>(
		handler: DescriptorHandler<TEntity, TDescriptorData, TSourceData>,
		agent: AgentState<TEntity>,
		type: DescriptorType<TDescriptorData, TSourceData>,
		data: TDescriptorData,
		provenance: StateProvenance
	): BindingProvider<TDescriptorData, TSourceData> {
		const bindingProvider: BindingProvider<TDescriptorData, TSourceData> = (derivedSources) =>
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
			);

		return bindingProvider;
	}
}
