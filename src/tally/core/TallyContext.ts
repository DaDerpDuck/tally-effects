import type { AnyProperty } from "../property/Property.js";
import { serializeDescriptor } from "../replication/descriptor/ReplicatedDescriptor.js";
import type { ReplicationEvent } from "../replication/ReplicationEvent.js";
import { serializeSource } from "../replication/source/ReplicatedSource.js";
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
import { AgentState } from "./AgentState.js";
import { tallyReport, type TallyReporter, type TallyReportOperation } from "./TallyReporter.js";

type ReplicationCallback<TEntity> = (agent: AgentState<TEntity>, event: ReplicationEvent) => void;
type SourceCallback<TEntity> = (agent: AgentState<TEntity>, source: Source) => void;
type DescriptorCallback<TEntity> = (agent: AgentState<TEntity>, descriptor: AnyDescriptor) => void;

const replicationOperationByEventKind = {
	added: "admit",
	updated: "update",
	removed: "destroy",
} as const satisfies Record<ReplicationEvent["event"]["kind"], TallyReportOperation>;

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

	private readonly sourceAddedCallbacks: CallbackSet<[AgentState<TEntity>, Source]>;
	private readonly sourceRemovedCallbacks: CallbackSet<[AgentState<TEntity>, Source]>;
	private readonly sourceUpdatedCallbacks: CallbackSet<[AgentState<TEntity>, Source]>;
	private readonly descriptorAddedCallbacks: CallbackSet<[AgentState<TEntity>, AnyDescriptor]>;
	private readonly descriptorRemovedCallbacks: CallbackSet<[AgentState<TEntity>, AnyDescriptor]>;
	private readonly descriptorUpdatedCallbacks: CallbackSet<[AgentState<TEntity>, AnyDescriptor]>;
	private readonly replicationCallbacks: CallbackSet<[AgentState<TEntity>, ReplicationEvent]>;

	private destroyed = false;

	constructor(private readonly reporter: TallyReporter) {
		this.sourceAddedCallbacks = new CallbackSet(
			reporter,
			{
				operation: "admit",
				event: "source-added",
			},
			(_, source) => ({ subject: { kind: "source", type: source.type.name, id: source.id } })
		);
		this.sourceRemovedCallbacks = new CallbackSet(
			reporter,
			{
				operation: "destroy",
				event: "source-removed",
			},
			(_, source) => ({ subject: { kind: "source", type: source.type.name, id: source.id } })
		);
		this.sourceUpdatedCallbacks = new CallbackSet(
			reporter,
			{
				operation: "update",
				event: "source-updated",
			},
			(_, source) => ({ subject: { kind: "source", type: source.type.name, id: source.id } })
		);
		this.descriptorAddedCallbacks = new CallbackSet(
			reporter,
			{
				operation: "admit",
				event: "descriptor-added",
			},
			(_, descriptor) => ({
				subject: {
					kind: "descriptor",
					type: descriptor.type.name,
					id: descriptor.id,
				},
			})
		);
		this.descriptorRemovedCallbacks = new CallbackSet(
			reporter,
			{
				operation: "destroy",
				event: "descriptor-removed",
			},
			(_, descriptor) => ({
				subject: {
					kind: "descriptor",
					type: descriptor.type.name,
					id: descriptor.id,
				},
			})
		);
		this.descriptorUpdatedCallbacks = new CallbackSet(
			reporter,
			{
				operation: "update",
				event: "descriptor-updated",
			},
			(_, descriptor) => ({
				subject: {
					kind: "descriptor",
					type: descriptor.type.name,
					id: descriptor.id,
				},
			})
		);
		this.replicationCallbacks = new CallbackSet(
			reporter,
			{
				operation: "update",
				event: "replication-emitted",
			},
			(_, event) => ({
				operation: replicationOperationByEventKind[event.event.kind],
			})
		);
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
	createAgentState(entity: TEntity, reporter?: TallyReporter) {
		this.assertAlive();
		const agent = new AgentState(entity, reporter ?? this.reporter);
		this.descriptorHandlers.forEach((handler, type) =>
			agent.registerDescriptorHandler(type as DescriptorType<unknown, unknown>, handler)
		);
		const disconnectSet = getOrInsertComputed(this.agentConnections, agent, () => new Set());
		disconnectSet.add(
			agent.onSourceAdded((source) => {
				this.sourceAddedCallbacks.emit(agent, source);
				if (source.type.replication && source.provenance.domain === "local")
					this.forwardReplication(
						"admit",
						"source-added",
						() => ({
							target: "source",
							event: { kind: "added", source: serializeSource(source) },
						}),
						agent
					);
			})
		);
		disconnectSet.add(
			agent.onSourceRemoved((source) => {
				this.sourceRemovedCallbacks.emit(agent, source);
				if (source.type.replication && source.provenance.domain === "local")
					this.forwardReplication(
						"destroy",
						"source-removed",
						() => ({
							target: "source",
							event: { kind: "removed", id: source.id },
						}),
						agent
					);
			})
		);
		disconnectSet.add(
			agent.onSourceUpdated((source) => {
				this.sourceUpdatedCallbacks.emit(agent, source);
				if (source.type.replication && source.provenance.domain === "local")
					this.forwardReplication(
						"update",
						"source-updated",
						() => ({
							target: "source",
							event: {
								kind: "updated",
								id: source.id,
								data: source.type.replication!.serialize(source.get()),
							},
						}),
						agent
					);
			})
		);
		disconnectSet.add(
			agent.onDescriptorAdded((descriptor) => {
				this.descriptorAddedCallbacks.emit(agent, descriptor);
				if (descriptor.type.replication && descriptor.provenance.domain === "local")
					this.forwardReplication(
						"admit",
						"descriptor-added",
						() => ({
							target: "descriptor",
							event: { kind: "added", descriptor: serializeDescriptor(descriptor) },
						}),
						agent
					);
			})
		);
		disconnectSet.add(
			agent.onDescriptorRemoved((descriptor) => {
				this.descriptorRemovedCallbacks.emit(agent, descriptor);
				if (descriptor.type.replication && descriptor.provenance.domain === "local")
					this.forwardReplication(
						"destroy",
						"descriptor-removed",
						() => ({
							target: "descriptor",
							event: { kind: "removed", id: descriptor.id },
						}),
						agent
					);
			})
		);
		disconnectSet.add(
			agent.onDescriptorUpdated((descriptor) => {
				this.descriptorUpdatedCallbacks.emit(agent, descriptor);
				if (descriptor.type.replication && descriptor.provenance.domain === "local")
					this.forwardReplication(
						"update",
						"descriptor-updated",
						() => ({
							target: "descriptor",
							event: {
								kind: "updated",
								id: descriptor.id,
								data: descriptor.type.replication!.serialize(descriptor.get()),
							},
						}),
						agent
					);
			})
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

	private forwardReplication(
		operation: "admit" | "destroy" | "update",
		event:
			| "descriptor-added"
			| "descriptor-removed"
			| "descriptor-updated"
			| "source-added"
			| "source-removed"
			| "source-updated",
		serialize: () => ReplicationEvent,
		agent: AgentState<TEntity>
	) {
		try {
			this.replicationCallbacks.emit(agent, serialize());
		} catch (error) {
			tallyReport(this.reporter, {
				code: "replication-serialization-failed",
				operation,
				event,
				error,
			});
		}
	}
}
