import type { StateProvenance } from "../Provenance.js";

export interface DescriptorOption {
	readonly provenance?: StateProvenance;
	readonly key?: string | undefined;
}
