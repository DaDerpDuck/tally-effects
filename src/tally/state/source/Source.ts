import type { Disconnect } from "../../util/Disconnect.js";
import type { DuplicationCandidate } from "../duplication/DuplicationCandidate.js";
import type { StateProvenance } from "../Provenance.js";
import type { SourceType } from "./SourceType.js";

/**
 * A runtime instance of a SourceType attached to an AgentState.
 *
 * Updating Source data through the `set` method recalculates its contributing
 * Modifiers while retaining its deterministic ordering.
 */
export interface Source<TData = unknown> extends DuplicationCandidate {
	readonly id: number;
	readonly type: SourceType<TData>;
	readonly priority: number;
	readonly provenance: StateProvenance;

	set(data: TData): void;
	/** Gets the current data the Source is using for its modifier contribution. */
	get(): TData;
	onUpdate(callback: (self: this) => void): Disconnect;
	onDestroy(callback: (self: this) => void): Disconnect;
	destroy(): void;
}
