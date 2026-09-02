import type { Disconnect } from "../../util/Disconnect.js";
import type { DuplicationCandidate } from "../duplication/DuplicationCandidate.js";
import type { StateProvenance } from "../Provenance.js";
import type { Source } from "../source/Source.js";
import type { DescriptorType } from "./DescriptorType.js";

export interface AnyDescriptor extends DuplicationCandidate {
	readonly id: number;
	readonly type: DescriptorType<unknown, unknown>;
	readonly provenance: StateProvenance;

	getSource(): Source;
	set(data: unknown): void;
	get(): unknown;
	onUpdate(callback: (self: this) => void): Disconnect;
	onDestroy(callback: (self: this) => void): Disconnect;
	destroy(): void;
}

/**
 * A runtime instance of a DescriptorType attached to an AgentState.
 *
 * Updating Descriptor data through the `set` method calls the update method
 * on the DescriptorBinding.
 */
export interface Descriptor<TDescriptorData, TSourceData> extends AnyDescriptor {
	readonly id: number;
	readonly type: DescriptorType<TDescriptorData, TSourceData>;
	readonly provenance: StateProvenance;

	getSource(): Source<TSourceData>;
	set(data: TDescriptorData): void;
	/** Gets the current data the Descriptor is using. */
	get(): TDescriptorData;
	onUpdate(callback: (self: this) => void): Disconnect;
	onDestroy(callback: (self: this) => void): Disconnect;
	/**
	 * Calls the destroy method on the associated DescriptorBinding
	 * and disconnects all callbacks.
	 */
	destroy(): void;
}
