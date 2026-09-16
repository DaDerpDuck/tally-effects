import type { AnyProperty } from "../property/Property.js";
import type { ReplicationEvent } from "../replication/ReplicationEvent.js";
import type { AnyDescriptor } from "../state/descriptor/Descriptor.js";
import type {
	AnyDescriptorHandler,
	DescriptorHandler,
} from "../state/descriptor/DescriptorHandler.js";
import type { AnyDescriptorType, DescriptorType } from "../state/descriptor/DescriptorType.js";
import type { Registrable, Registry } from "../state/Registrable.js";
import type { Source } from "../state/source/Source.js";
import type { AnySourceType } from "../state/source/SourceType.js";
import { CallbackSet } from "../util/CallbackSet.js";
import type { Disconnect } from "../util/Disconnect.js";
import { getOrInsertComputed } from "../util/GetOrInsert.js";
import { AgentState, type AgentStateOptions } from "./AgentState.js";
import type { TallyReporter, TallyReportOperation } from "./TallyReporter.js";

type ReplicationCallback<TEntity> = (agent: AgentState<TEntity>, event: ReplicationEvent) => void;
type SourceCallback<TEntity> = (agent: AgentState<TEntity>, source: Source) => void;
type DescriptorCallback<TEntity> = (agent: AgentState<TEntity>, descriptor: AnyDescriptor) => void;

const replicationOperationByEventKind = {
	added: "admit",
	updated: "update",
	removed: "destroy",
} as const satisfies Record<ReplicationEvent["event"]["kind"], TallyReportOperation>;

export interface TallyContextOptions {
	reporter: TallyReporter;
}

/**
 * Coordinates shared Tally configuration and lifecycle behavior across
 * multiple AgentStates.
 *
 * A TallyContext is an optional object that owns the registries for Properties,
 * SourceTypes, and DescriptorTypes, stores DescriptorHandlers, creates configured
 * AgentStates, and forwards replication events emitted by those AgentStates.
 *
 * DescriptorHandlers should be registered before creating AgentStates so that
 * newly created agents receive the expected handler configuration.
 */
export class TallyContext<TEntity> {
	private readonly registry: Registry = {
		sources: new Map(),
		properties: new Map(),
		descriptors: new Map(),
	};
	private readonly descriptorHandlers = new Map<AnyDescriptorType, AnyDescriptorHandler>();
	private readonly agentConnections = new Map<AgentState<TEntity>, Set<Disconnect>>();

	private readonly reporter: TallyReporter;

	private readonly sourceAddedCallbacks: CallbackSet<[AgentState<TEntity>, Source]>;
	private readonly sourceRemovedCallbacks: CallbackSet<[AgentState<TEntity>, Source]>;
	private readonly sourceUpdatedCallbacks: CallbackSet<[AgentState<TEntity>, Source]>;
	private readonly descriptorAddedCallbacks: CallbackSet<[AgentState<TEntity>, AnyDescriptor]>;
	private readonly descriptorRemovedCallbacks: CallbackSet<[AgentState<TEntity>, AnyDescriptor]>;
	private readonly descriptorUpdatedCallbacks: CallbackSet<[AgentState<TEntity>, AnyDescriptor]>;
	private readonly replicationCallbacks: CallbackSet<[AgentState<TEntity>, ReplicationEvent]>;

	private destroyed = false;

	constructor(private readonly options: TallyContextOptions) {
		const { reporter } = options;
		this.reporter = reporter;

		this.sourceAddedCallbacks = new CallbackSet(reporter, (_, source) => ({
			operation: "admit",
			event: "source-added",
			subject: { kind: "source", type: source.type.name, id: source.id },
		}));
		this.sourceRemovedCallbacks = new CallbackSet(reporter, (_, source) => ({
			operation: "destroy",
			event: "source-removed",
			subject: { kind: "source", type: source.type.name, id: source.id },
		}));
		this.sourceUpdatedCallbacks = new CallbackSet(reporter, (_, source) => ({
			operation: "update",
			event: "source-updated",
			subject: { kind: "source", type: source.type.name, id: source.id },
		}));
		this.descriptorAddedCallbacks = new CallbackSet(reporter, (_, descriptor) => ({
			operation: "admit",
			event: "descriptor-added",
			subject: {
				kind: "descriptor",
				type: descriptor.type.name,
				id: descriptor.id,
			},
		}));
		this.descriptorRemovedCallbacks = new CallbackSet(reporter, (_, descriptor) => ({
			operation: "destroy",
			event: "descriptor-removed",
			subject: {
				kind: "descriptor",
				type: descriptor.type.name,
				id: descriptor.id,
			},
		}));
		this.descriptorUpdatedCallbacks = new CallbackSet(reporter, (_, descriptor) => ({
			operation: "update",
			event: "descriptor-updated",
			subject: {
				kind: "descriptor",
				type: descriptor.type.name,
				id: descriptor.id,
			},
		}));
		this.replicationCallbacks = new CallbackSet(reporter, (_, event) => ({
			operation: replicationOperationByEventKind[event.event.kind],
			event: "replication-emitted",
		}));
	}

	get sources(): ReadonlyMap<string, AnySourceType> {
		return this.registry.sources;
	}

	get properties(): ReadonlyMap<string, AnyProperty> {
		return this.registry.properties;
	}

	get descriptors(): ReadonlyMap<string, AnyDescriptorType> {
		return this.registry.descriptors;
	}

	/**
	 * Creates and configures an AgentState with the TallyContext's stored
	 * DescriptorHandlers.
	 */
	createAgentState(entity: TEntity, override?: Partial<AgentStateOptions>) {
		this.assertAlive();
		const agent = new AgentState(entity, { ...this.options, ...override });
		this.descriptorHandlers.forEach((handler, type) =>
			agent.registerDescriptorHandler(type as DescriptorType<unknown, unknown>, handler)
		);
		const disconnectSet = getOrInsertComputed(this.agentConnections, agent, () => new Set());
		disconnectSet.add(
			agent.onSourceAdded((source) => this.sourceAddedCallbacks.emit(agent, source))
		);
		disconnectSet.add(
			agent.onSourceRemoved((source) => this.sourceRemovedCallbacks.emit(agent, source))
		);
		disconnectSet.add(
			agent.onSourceUpdated((source) => this.sourceUpdatedCallbacks.emit(agent, source))
		);
		disconnectSet.add(
			agent.onDescriptorAdded((descriptor) =>
				this.descriptorAddedCallbacks.emit(agent, descriptor)
			)
		);
		disconnectSet.add(
			agent.onDescriptorRemoved((descriptor) =>
				this.descriptorRemovedCallbacks.emit(agent, descriptor)
			)
		);
		disconnectSet.add(
			agent.onDescriptorUpdated((descriptor) =>
				this.descriptorUpdatedCallbacks.emit(agent, descriptor)
			)
		);
		disconnectSet.add(
			agent.onReplicationEmit((event) => this.replicationCallbacks.emit(agent, event))
		);
		disconnectSet.add(
			agent.onDestroy(() => {
				// The agent should already disconnect its callbacks
				// this.agentConnections.get(agent)?.forEach((disconnect) => disconnect());
				this.agentConnections.delete(agent);
			})
		);
		return agent;
	}

	/**
	 * Registers a Property, SourceType, or DescriptorType for this TallyContext.
	 * Objects are addressed through its name.
	 */
	register<T extends Registrable>(definition: T): T {
		this.assertAlive();
		definition.register(this.registry);
		return definition;
	}

	/**
	 * Registers a local descriptor handler and configures it on any future
	 * created AgentStates.
	 *
	 * Warning: Register descriptor handlers before creating new AgentStates,
	 * otherwise old AgentStates will not have the handler.
	 */
	registerDescriptorHandler<TDescriptorData, TSourceData>(
		type: DescriptorType<TDescriptorData, TSourceData>,
		handler: DescriptorHandler<TEntity, TDescriptorData, TSourceData>
	) {
		this.assertAlive();
		this.descriptorHandlers.set(type, handler as AnyDescriptorHandler);
	}

	onSourceAdded(callback: SourceCallback<TEntity>): Disconnect {
		if (this.destroyed) return () => {};
		return this.sourceAddedCallbacks.add(callback);
	}

	onSourceRemoved(callback: SourceCallback<TEntity>): Disconnect {
		if (this.destroyed) return () => {};
		return this.sourceRemovedCallbacks.add(callback);
	}

	onSourceUpdated(callback: SourceCallback<TEntity>): Disconnect {
		if (this.destroyed) return () => {};
		return this.sourceUpdatedCallbacks.add(callback);
	}

	onDescriptorAdded(callback: DescriptorCallback<TEntity>): Disconnect {
		if (this.destroyed) return () => {};
		return this.descriptorAddedCallbacks.add(callback);
	}

	onDescriptorRemoved(callback: DescriptorCallback<TEntity>): Disconnect {
		if (this.destroyed) return () => {};
		return this.descriptorRemovedCallbacks.add(callback);
	}

	onDescriptorUpdated(callback: DescriptorCallback<TEntity>): Disconnect {
		if (this.destroyed) return () => {};
		return this.descriptorUpdatedCallbacks.add(callback);
	}

	/**
	 * Any emitted replication events from AgentStates created from this TallyContext
	 * are fired through this callback.
	 *
	 * Applications are expected to transport the replication event themselves to the
	 * corresponding receiver.
	 */
	onReplicationEmit(callback: ReplicationCallback<TEntity>): Disconnect {
		if (this.destroyed) return () => {};
		return this.replicationCallbacks.add(callback);
	}

	/**
	 * Disconnects all callbacks. Does not destroy created agents.
	 */
	destroy() {
		if (this.destroyed) return;
		this.destroyed = true;
		this.agentConnections.forEach((disconnectSet) =>
			disconnectSet.forEach((disconnect) => disconnect())
		);
		this.agentConnections.clear();
		this.sourceAddedCallbacks.clear();
		this.sourceRemovedCallbacks.clear();
		this.sourceUpdatedCallbacks.clear();
		this.descriptorAddedCallbacks.clear();
		this.descriptorRemovedCallbacks.clear();
		this.descriptorUpdatedCallbacks.clear();
		this.replicationCallbacks.clear();
	}

	private assertAlive() {
		if (this.destroyed) throw new Error("TallyContext was destroyed");
	}
}
