import type { AgentState } from "../../core/AgentState.js";
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

	constructor(
		private readonly agent: AgentState<unknown>,
		private readonly resolveType: (name: string) => AnySourceType | undefined
	) {}

	apply(events: readonly ReplicationEvent[]) {
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

	applySnapshot(snapshot: ReplicationSnapshot) {
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

	private addSource(replicatedSource: ReplicatedSource): Source {
		if (this.replicatedSources.has(replicatedSource.id))
			throw new Error("Attempted to add an existing replicated source");
		const sourceType = this.resolveType(replicatedSource.type);
		if (!sourceType) throw new Error("Attempted to add a nonexistent replicated source");
		if (!sourceType.replication)
			throw new Error(
				"Attempted to add a replicated source without a replication definition"
			);

		const source = this.agent.addSource(
			sourceType as SourceType<unknown>,
			sourceType.replication.deserialize(replicatedSource.data),
			{
				priority: replicatedSource.priority,
				key: replicatedSource.key,
				provenance: {
					domain: "replicated",
					sequence: replicatedSource.id,
				},
			}
		);
		if (!source) throw new Error("Unable to add a replicated source due to duplication policy");

		this.replicatedSources.set(replicatedSource.id, source);
		source.onDestroy(() => {
			if (this.replicatedSources.get(replicatedSource.id) === source)
				this.replicatedSources.delete(replicatedSource.id);
		});
		return source;
	}

	private updateSource(sourceId: SourceId, data: ReplicationValue) {
		const source = this.replicatedSources.get(sourceId);
		if (!source)
			throw new Error(
				"Attempted to update a replicated source without a locally created source."
			);
		if (!source.type.replication)
			throw new Error(
				"Attempted to update a replicated source without a ReplicationDefinition"
			);
		source.set(source.type.replication.deserialize(data));
	}

	private removeSource(sourceId: SourceId) {
		this.replicatedSources.get(sourceId)?.destroy();
		this.replicatedSources.delete(sourceId);
	}
}
