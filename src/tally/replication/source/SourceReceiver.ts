import type { AgentState } from "../../core/AgentState.js";
import { AgentMutationGate } from "../../core/AgentMutationGate.js";
import type { Source } from "../../state/source/Source.js";
import type { AnySourceType, SourceType } from "../../state/source/SourceType.js";
import type { ReplicationEvent } from "../ReplicationEvent.js";
import type { ReplicationReceiver } from "../ReplicationReceiver.js";
import type { ReplicationSnapshot } from "../ReplicationSnapshot.js";
import type { ReplicationValue } from "../ReplicationValue.js";
import type { ReplicatedSource, SourceId } from "./ReplicatedSource.js";
import type { SourceReplicationEvent } from "./SourceReplicationEvent.js";

/**
 * Reconstructs replicated Sources in an AgentState.
 *
 * @see {@link ReplicationReceiver}
 */
export class SourceReceiver implements ReplicationReceiver {
	private readonly replicatedSources = new Map<number, Source>();
	private readonly mutationGate: AgentMutationGate;
	/**
	 * @mutationReentrancy restricted
	 * @requiresMutationGate
	 */
	private readonly resolveType: (name: string) => AnySourceType | undefined;

	constructor(
		private readonly agent: AgentState<unknown>,
		resolveType: (name: string) => AnySourceType | undefined
	) {
		this.mutationGate = AgentMutationGate.forAgent(agent);
		this.resolveType = resolveType;
	}

	/** @checksMutationGate */
	apply(events: readonly ReplicationEvent[]) {
		this.mutationGate.assertMutationAllowed();
		const errors: { event: SourceReplicationEvent; error: Error }[] = [];

		this.agent.batch(() => {
			events
				.filter((event) => event.target === "source")
				.map((event) => event.event)
				.forEach((event) => {
					try {
						if (event.kind === "added") this.addSource(event.source);
						else if (event.kind === "updated") this.updateSource(event.id, event.data);
						else if (event.kind === "removed") this.removeSource(event.id);
					} catch (err) {
						errors.push({
							event,
							error: err instanceof Error ? err : new Error(String(err)),
						});
					}
				});
		});

		if (errors.length > 0)
			throw new AggregateError(
				errors.map((e) => e.error),
				`Failed to apply ${errors.length} replication event(s)`
			);
	}

	/** @checksMutationGate */
	applySnapshot(snapshot: ReplicationSnapshot) {
		this.mutationGate.assertMutationAllowed();
		const errors: { source: ReplicatedSource; error: Error }[] = [];

		this.agent.batch(() => {
			const markForRemoval = new Set(this.replicatedSources.keys());
			for (const replicatedSource of snapshot.sources) {
				try {
					markForRemoval.delete(replicatedSource.id);
					if (this.replicatedSources.has(replicatedSource.id))
						this.updateSource(replicatedSource.id, replicatedSource.data);
					else this.addSource(replicatedSource);
				} catch (err) {
					errors.push({
						source: replicatedSource,
						error: err instanceof Error ? err : new Error(String(err)),
					});
				}
			}
			markForRemoval.forEach((id) => this.removeSource(id));
		});

		if (errors.length > 0)
			throw new AggregateError(
				errors.map((e) => e.error),
				`Failed to apply ${errors.length} replication source(s)`
			);
	}

	/** @providesMutationGate */
	private addSource(replicatedSource: ReplicatedSource): Source {
		if (this.replicatedSources.has(replicatedSource.id))
			throw new Error("Attempted to add an existing replicated source");
		const sourceType = this.mutationGate.evaluate("source-type-resolution", () =>
			this.resolveType(replicatedSource.type)
		);
		if (!sourceType) throw new Error("Attempted to add a nonexistent replicated source");
		const replication = sourceType.replication;
		if (!replication)
			throw new Error(
				"Attempted to add a replicated source without a replication definition"
			);

		const data = this.mutationGate.evaluate("source-deserialization", () =>
			replication.deserialize(replicatedSource.data)
		);
		const source = this.agent.addSource(sourceType as SourceType<unknown>, data, {
			priority: replicatedSource.priority,
			key: replicatedSource.key,
			provenance: {
				domain: "replicated",
				sequence: replicatedSource.id,
			},
		});
		if (!source) throw new Error("Unable to add a replicated source due to duplication policy");

		this.replicatedSources.set(replicatedSource.id, source);
		source.onDestroy(() => {
			if (this.replicatedSources.get(replicatedSource.id) === source)
				this.replicatedSources.delete(replicatedSource.id);
		});
		return source;
	}

	/** @providesMutationGate */
	private updateSource(sourceId: SourceId, data: ReplicationValue) {
		const source = this.replicatedSources.get(sourceId);
		if (!source)
			throw new Error(
				"Attempted to update a replicated source without a locally created source."
			);
		const replication = source.type.replication;
		if (!replication)
			throw new Error(
				"Attempted to update a replicated source without a ReplicationDefinition"
			);
		const decoded = this.mutationGate.evaluate("source-deserialization", () =>
			replication.deserialize(data)
		);
		source.set(decoded);
	}

	private removeSource(sourceId: SourceId) {
		this.replicatedSources.get(sourceId)?.destroy();
		this.replicatedSources.delete(sourceId);
	}
}
