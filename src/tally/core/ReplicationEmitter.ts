import { serializeDescriptor } from "../replication/descriptor/ReplicatedDescriptor.js";
import type { ReplicationEvent } from "../replication/ReplicationEvent.js";
import { serializeSource } from "../replication/source/ReplicatedSource.js";
import type { AnyDescriptor } from "../state/descriptor/Descriptor.js";
import type { Source } from "../state/source/Source.js";
import { CallbackSet } from "../util/CallbackSet.js";
import type { Disconnect } from "../util/Disconnect.js";
import { tallyReport, type TallyReporter, type TallyReportOperation } from "./TallyReporter.js";

const replicationOperationByEventKind = {
	added: "admit",
	updated: "update",
	removed: "destroy",
} as const satisfies Record<ReplicationEvent["event"]["kind"], TallyReportOperation>;

type ReplicationCallback = (event: ReplicationEvent) => void;

export class ReplicationEmitter {
	private readonly replicationCallbacks: CallbackSet<[ReplicationEvent]>;

	constructor(private readonly reporter: TallyReporter) {
		this.replicationCallbacks = new CallbackSet(reporter, (event) => ({
			operation: replicationOperationByEventKind[event.event.kind],
			event: "replication-emitted",
		}));
	}

	forwardSourceReplication(source: Source<unknown>, operation: "added" | "updated" | "removed") {
		if (!source.type.replication || source.provenance.domain !== "local") return;
		if (this.replicationCallbacks.isEmpty()) return;

		switch (operation) {
			case "added":
				this.forwardReplication("admit", "source-added", () => ({
					target: "source",
					event: { kind: "added", source: serializeSource(source) },
				}));
				break;
			case "updated":
				this.forwardReplication("update", "source-updated", () => ({
					target: "source",
					event: {
						kind: "updated",
						id: source.id,
						data: source.type.replication!.serialize(source.get()),
					},
				}));
				break;
			case "removed":
				this.forwardReplication("destroy", "source-removed", () => ({
					target: "source",
					event: { kind: "removed", id: source.id },
				}));
				break;
		}
	}

	forwardDescriptorReplication(
		descriptor: AnyDescriptor,
		operation: "added" | "updated" | "removed"
	) {
		if (!descriptor.type.replication || descriptor.provenance.domain !== "local") return;
		if (this.replicationCallbacks.isEmpty()) return;

		switch (operation) {
			case "added":
				this.forwardReplication("admit", "descriptor-added", () => ({
					target: "descriptor",
					event: { kind: "added", descriptor: serializeDescriptor(descriptor) },
				}));
				break;
			case "updated":
				this.forwardReplication("update", "descriptor-updated", () => ({
					target: "descriptor",
					event: {
						kind: "updated",
						id: descriptor.id,
						data: descriptor.type.replication!.serialize(descriptor.get()),
					},
				}));
				break;
			case "removed":
				this.forwardReplication("destroy", "descriptor-removed", () => ({
					target: "descriptor",
					event: { kind: "removed", id: descriptor.id },
				}));
				break;
		}
	}

	disconnectAll() {
		this.replicationCallbacks.clear();
	}

	connect(callback: ReplicationCallback): Disconnect {
		return this.replicationCallbacks.add(callback);
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
		serialize: () => ReplicationEvent
	) {
		try {
			this.replicationCallbacks.emit(serialize());
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
