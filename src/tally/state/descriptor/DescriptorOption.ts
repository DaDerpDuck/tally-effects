import type { StateProvenance } from "../Provenance.js";

export interface DescriptorOption {
	readonly provenance?: StateProvenance | undefined;
	readonly key?: string | undefined;
}
