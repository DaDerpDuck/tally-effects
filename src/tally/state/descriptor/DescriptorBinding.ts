import type { Source } from "../source/Source.js";

export interface AnyDescriptorBinding {
	readonly source: Source;
	update(data: unknown): void;
	destroy(): void;
}

/**
 * Return value from a descriptor handler. Changes to the Descriptor's data are
 * delivered through `update`. When the Descriptor is destroyed, `destroy` is called.
 *
 * Bindings may mutate the AgentState, including through Sources they
 * own. This mutation reentrancy is supported.
 */
export interface DescriptorBinding<TDescriptorData, TSourceData> extends AnyDescriptorBinding {
	readonly source: Source<TSourceData>;
	update(data: TDescriptorData): void;
	destroy(): void;
}
