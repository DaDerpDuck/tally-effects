import { type Property } from "../property/Property.js";
import type { ReplicationEvent } from "../replication/ReplicationEvent.js";
import { AdmissionCoordinator } from "../state/AdmissionCoordinator.js";
import type { AnyDescriptor, Descriptor } from "../state/descriptor/Descriptor.js";
import { DescriptorBuilder } from "../state/descriptor/DescriptorBuilder.js";
import type { DescriptorHandler } from "../state/descriptor/DescriptorHandler.js";
import type { DescriptorOption } from "../state/descriptor/DescriptorOption.js";
import { DescriptorType } from "../state/descriptor/DescriptorType.js";
import { DuplicationIndex } from "../state/duplication/DuplicationIndex.js";
import { DuplicationResolver } from "../state/duplication/DuplicationResolver.js";
import type { Source } from "../state/source/Source.js";
import { SourceBuilder } from "../state/source/SourceBuilder.js";
import type { SourceOption } from "../state/source/SourceOption.js";
import { SourceType } from "../state/source/SourceType.js";
import { CallbackSet } from "../util/CallbackSet.js";
import type { Disconnect } from "../util/Disconnect.js";
import { IdCounter } from "../util/IdCounter.js";
import { DescriptorManager, type DescriptorCallback } from "./DescriptorManager.js";
import { ReplicationEmitter } from "./ReplicationEmitter.js";
import { SourceManager, type PropertyCallback, type SourceCallback } from "./SourceManager.js";
import type { TallyReporter } from "./TallyReporter.js";

type DestroyCallback = () => void;
type ReplicationCallback = (event: ReplicationEvent) => void;

export interface AgentStateOptions {
	reporter: TallyReporter;
}

/**
 * Holds the runtime Tally state for a single entity.
 *
 * AgentState owns Sources, Descriptors, property resolution, and
 * lifecycle observation for the associated entity.
 */
export class AgentState<TEntity> {
	private readonly duplicationIndex: DuplicationIndex;
	private readonly duplicationResolver: DuplicationResolver;
	private readonly admissionCoordinator: AdmissionCoordinator;
	private readonly counter: IdCounter;
	private readonly reporter: TallyReporter;

	private readonly sources: SourceManager;
	private readonly descriptors: DescriptorManager<TEntity>;

	private readonly destroyCallbacks: CallbackSet<[]>;

	private replicationEmitter: ReplicationEmitter | undefined;
	private destroyed = false;

	constructor(
		public readonly entity: TEntity,
		options: AgentStateOptions
	) {
		this.duplicationIndex = new DuplicationIndex();
		this.duplicationResolver = new DuplicationResolver(this.duplicationIndex);
		this.admissionCoordinator = new AdmissionCoordinator(
			this.duplicationIndex,
			this.duplicationResolver
		);

		this.counter = new IdCounter();
		const { reporter } = options;
		this.reporter = reporter;

		this.sources = new SourceManager(reporter, this.counter, this.admissionCoordinator);
		this.descriptors = new DescriptorManager(
			reporter,
			this.counter,
			this.admissionCoordinator,
			this.sources
		);

		this.destroyCallbacks = new CallbackSet(reporter, () => ({
			operation: "destroy",
		}));
	}

	/**
	 * Adds a Source of the given type to this AgentState.
	 *
	 * The SourceType's duplication policy is applied before creation.
	 * The SourceType's default priority is used unless overridden.
	 *
	 * @returns The created Source, or `undefined` when rejected by
	 * the duplication policy.
	 */
	addSource<TData extends undefined>(
		type: SourceType<TData>,
		data?: TData,
		options?: SourceOption
	): Source<TData> | undefined;
	addSource<TData>(
		type: SourceType<TData>,
		data: TData,
		options?: SourceOption
	): Source<TData> | undefined;
	addSource<TData>(
		type: SourceType<TData>,
		data: TData,
		options?: SourceOption
	): Source<TData> | undefined {
		this.assertAlive();
		return this.sources.addSource(type, data, options);
	}

	/**
	 * Creates a Source builder for this AgentState and type.
	 * Its configured options apply to every subsequent {@link SourceBuilder.add}
	 * call. Adding through the builder uses the same behavior as
	 * {@link addSource}.
	 */
	makeSource<TData>(type: SourceType<TData>): SourceBuilder<TData> {
		return new SourceBuilder(type, (type, data, option) => this.addSource(type, data, option));
	}

	/**
	 * Adds a Descriptor of the given type to this AgentState. A handler must
	 * be registered prior to calling this method.
	 *
	 * The Descriptor's duplication policy is applied before creation.
	 *
	 * @returns The created Descriptor, or `undefined` if the handler
	 * rejects creation.
	 */
	addDescriptor<TDescriptorData extends undefined, TSourceData>(
		type: DescriptorType<TDescriptorData, TSourceData>,
		data?: TDescriptorData,
		options?: DescriptorOption
	): Descriptor<TDescriptorData, TSourceData> | undefined;
	addDescriptor<TDescriptorData, TSourceData>(
		type: DescriptorType<TDescriptorData, TSourceData>,
		data: TDescriptorData,
		options?: DescriptorOption
	): Descriptor<TDescriptorData, TSourceData> | undefined;
	addDescriptor<TDescriptorData, TSourceData>(
		type: DescriptorType<TDescriptorData, TSourceData>,
		data: TDescriptorData,
		options?: DescriptorOption
	): Descriptor<TDescriptorData, TSourceData> | undefined {
		this.assertAlive();
		return this.descriptors.addDescriptor(this, type, data, options);
	}

	/**
	 * Creates a Descriptor builder for this AgentState and type.
	 * Its configured options apply to every subsequent {@link DescriptorBuilder.add}
	 * call. Adding through the builder uses the same behavior as
	 * {@link addDescriptor}.
	 */
	makeDescriptor<TDescriptorData, TSourceData>(
		type: DescriptorType<TDescriptorData, TSourceData>
	): DescriptorBuilder<TDescriptorData, TSourceData> {
		return new DescriptorBuilder(type, (type, data, option) =>
			this.addDescriptor(type, data, option)
		);
	}

	/**
	 * Registers a local descriptor handler. If an AgentState was created through
	 * `TallyContext.createAgentState`, then TallyContext will register its registered
	 * descriptor handlers to this agent during creation.
	 *
	 * Can be used to override existing descriptor handlers.
	 */
	registerDescriptorHandler<TDescriptorData, TSourceData>(
		type: DescriptorType<TDescriptorData, TSourceData>,
		handler: DescriptorHandler<TEntity, TDescriptorData, TSourceData>
	) {
		this.assertAlive();
		return this.descriptors.registerDescriptorHandler(type, handler);
	}

	/**
	 * Resolves the current value of the passed Property.
	 *
	 * Property values are cached at resolution, so calling this method only performs
	 * a simply lookup.
	 *
	 * Warning: Calling this within a {@link batch} call will get the resolved property
	 * from when the batch call began. This may result in retrieving stale data.
	 * A property whose resolver or equality hook failed also returns its last successful
	 * cached value until a later resolution succeeds.
	 */
	get<T>(property: Property<T>): T {
		return this.sources.get(property);
	}

	/**
	 * Fires when a property changes to a value different from its previous value.
	 * Property equality is determined through {@link Property.valueEquals}.
	 *
	 * During a {@link batch} call, rather than firing for every intermediate property
	 * change, property resolution is deferred to the end of the batch call.
	 * Resolution and equality failures are reported and do not prevent completed Source
	 * mutations or lifecycle events.
	 */
	onPropertyChanged<T>(property: Property<T>, callback: PropertyCallback<T>): Disconnect {
		if (this.destroyed) return () => {};
		return this.sources.onPropertyChanged(property, callback);
	}

	hasSource(type: SourceType<unknown>): boolean {
		return this.sources.hasSource(type);
	}

	/**
	 * Retrieves all active Sources or all active Sources of a given type if
	 * one is passed.
	 */
	getSources(): ReadonlySet<Source>;
	getSources<TData>(type: SourceType<TData>): ReadonlySet<Source<TData>>;
	getSources(type?: SourceType<unknown>): ReadonlySet<Source> {
		return this.sources.getSources(type);
	}

	/**
	 * Retrieves all active Descriptors or all active Descriptors of a given type
	 * if one is passed.
	 */
	getDescriptors(): ReadonlySet<AnyDescriptor>;
	getDescriptors<TDescriptorData, TSourceData>(
		type: DescriptorType<TDescriptorData, TSourceData>
	): ReadonlySet<Descriptor<TDescriptorData, TSourceData>>;
	getDescriptors(
		type?: DescriptorType<unknown, unknown>
	): ReadonlySet<Descriptor<unknown, unknown>> {
		return this.descriptors.getDescriptors(type);
	}

	/**
	 * Defers property resolution until the outermost batch completes. Callbacks
	 * are only fired once when the resolution completes.
	 *
	 * Nested batches are supported. Property resolution and equality failures are
	 * reported after the batch rather than thrown from the batch callback.
	 */
	batch<T>(callback: () => T): T {
		return this.sources.batch(callback);
	}

	onSourceAdded(callback: SourceCallback): Disconnect {
		if (this.destroyed) return () => {};
		return this.sources.onSourceAdded(callback);
	}

	onSourceRemoved(callback: SourceCallback): Disconnect {
		if (this.destroyed) return () => {};
		return this.sources.onSourceRemoved(callback);
	}

	onSourceUpdated(callback: SourceCallback): Disconnect {
		if (this.destroyed) return () => {};
		return this.sources.onSourceUpdated(callback);
	}

	onDescriptorAdded(callback: DescriptorCallback): Disconnect {
		if (this.destroyed) return () => {};
		return this.descriptors.onDescriptorAdded(callback);
	}

	onDescriptorRemoved(callback: DescriptorCallback): Disconnect {
		if (this.destroyed) return () => {};
		return this.descriptors.onDescriptorRemoved(callback);
	}

	onDescriptorUpdated(callback: DescriptorCallback): Disconnect {
		if (this.destroyed) return () => {};
		return this.descriptors.onDescriptorUpdated(callback);
	}

	/**
	 * Fires portable lifecycle events for locally authoritative replicated Sources
	 * and Descriptors. Applications own transport and should route each event to
	 * the corresponding receiver.
	 */
	onReplicationEmit(callback: ReplicationCallback): Disconnect {
		if (this.destroyed) return () => {};

		if (!this.replicationEmitter) {
			const emitter = new ReplicationEmitter(this.reporter);
			this.sources.setReplicationForwarder((source, operation) =>
				emitter.forwardSourceReplication(source, operation)
			);
			this.descriptors.setReplicationForwarder((descriptor, operation) =>
				emitter.forwardDescriptorReplication(descriptor, operation)
			);
			this.replicationEmitter = emitter;
		}

		return this.replicationEmitter.connect(callback);
	}

	onDestroy(callback: DestroyCallback): Disconnect {
		if (this.destroyed) return () => {};
		return this.destroyCallbacks.add(callback);
	}

	destroyAllSources() {
		this.sources.destroyAllSources();
	}

	destroyAllDescriptors() {
		this.descriptors.destroyAllDescriptors();
	}

	/**
	 * Disconnects all callbacks and destroys all active Sources and Descriptors
	 *
	 * This operation is terminal and future mutations will throw an error.
	 */
	destroy() {
		if (this.destroyed) return;
		this.destroyed = true;
		this.destroyCallbacks.emit();
		this.sources.disconnectAll();
		this.descriptors.disconnectAll();

		this.destroyAllSources();
		this.destroyAllDescriptors();

		this.replicationEmitter?.disconnectAll();
		this.destroyCallbacks.clear();
	}

	private assertAlive() {
		if (this.destroyed) throw new Error("AgentState was destroyed");
	}
}
