import type { AdmissionCoordinator, AdmissionReceipt } from "../state/AdmissionCoordinator.js";
import type { AdmissionPlan } from "../state/AdmissionPlan.js";
import type { AnyDescriptor, Descriptor } from "../state/descriptor/Descriptor.js";
import type { DescriptorBinding } from "../state/descriptor/DescriptorBinding.js";
import type {
	AnyDescriptorHandler,
	DescriptorHandler,
} from "../state/descriptor/DescriptorHandler.js";
import type { DescriptorOption } from "../state/descriptor/DescriptorOption.js";
import { DescriptorRuntime, type DescriptorHost } from "../state/descriptor/DescriptorRuntime.js";
import type { AnyDescriptorType, DescriptorType } from "../state/descriptor/DescriptorType.js";
import type { StateProvenance } from "../state/Provenance.js";
import type { Source } from "../state/source/Source.js";
import type { SourceOption } from "../state/source/SourceOption.js";
import { CallbackSet } from "../util/CallbackSet.js";
import type { Disconnect } from "../util/Disconnect.js";
import { getOrInsertComputed } from "../util/GetOrInsert.js";
import type { IdCounter } from "../util/IdCounter.js";
import type { AgentState } from "./AgentState.js";
import type { SourceManager } from "./SourceManager.js";
import type { TallyReporter } from "./TallyReporter.js";

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

	private readonly descriptorAddedCallbacks: CallbackSet<
		[descriptor: Descriptor<unknown, unknown>]
	>;
	private readonly descriptorRemovedCallbacks: CallbackSet<
		[descriptor: Descriptor<unknown, unknown>]
	>;
	private readonly descriptorUpdatedCallbacks: CallbackSet<
		[descriptor: Descriptor<unknown, unknown>]
	>;

	constructor(
		private readonly reporter: TallyReporter,
		private readonly counter: IdCounter,
		private readonly admission: AdmissionCoordinator,
		private readonly sources: SourceManager
	) {
		this.descriptorAddedCallbacks = new CallbackSet(
			reporter,
			{
				operation: "admit",
				event: "descriptor-added",
			},
			(descriptor) => ({ kind: "descriptor", type: descriptor.type.name, id: descriptor.id })
		);
		this.descriptorRemovedCallbacks = new CallbackSet(
			reporter,
			{
				operation: "destroy",
				event: "descriptor-removed",
			},
			(descriptor) => ({ kind: "descriptor", type: descriptor.type.name, id: descriptor.id })
		);
		this.descriptorUpdatedCallbacks = new CallbackSet(
			reporter,
			{
				operation: "update",
				event: "descriptor-updated",
			},
			(descriptor) => ({ kind: "descriptor", type: descriptor.type.name, id: descriptor.id })
		);
	}

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

		let receipt: AdmissionReceipt<Descriptor<TDescriptorData, TSourceData>> | undefined;
		try {
			this.sources.batch(
				() =>
					(receipt = this.admission.admit(
						this.planDescriptor(
							handler as DescriptorHandler<TEntity, TDescriptorData, TSourceData>,
							agent,
							type,
							data,
							options
						)
					))
			);
		} catch (e) {
			const errors = [e];
			try {
				if (receipt) this.sources.batch(() => receipt!.rollback());
			} catch (e2) {
				errors.push(e2);
			}
			if (errors.length === 1) throw errors[0];
			else throw new AggregateError(errors, "Failed to batch properties", { cause: e });
		}
		return this.sources.batch(() => receipt?.publish());
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
		return this.descriptorAddedCallbacks.add(callback);
	}

	onDescriptorRemoved(callback: DescriptorCallback): Disconnect {
		return this.descriptorRemovedCallbacks.add(callback);
	}

	onDescriptorUpdated(callback: DescriptorCallback): Disconnect {
		return this.descriptorUpdatedCallbacks.add(callback);
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
			getReporter: () => this.reporter,
			tryBind: (derivedSources) => bindingProvider(derivedSources),
			installDescriptor: (descriptor) => {
				getOrInsertComputed(this.descriptorMap, type, () => new Set()).add(descriptor);
			},
			uninstallDescriptor: (descriptor) => {
				this.descriptorMap.get(type)?.delete(descriptor);
			},
			announceAdded: (descriptor) => this.descriptorAddedCallbacks.emit(descriptor),
			announceUpdated: (descriptor) => this.descriptorUpdatedCallbacks.emit(descriptor),
			announceDestroyed: (descriptor) => this.descriptorRemovedCallbacks.emit(descriptor),
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
