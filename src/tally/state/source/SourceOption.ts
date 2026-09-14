import type { StateProvenance } from "../Provenance.js";

export interface SourceOption {
	readonly priority?: number;
	readonly provenance?: StateProvenance;
	readonly key?: string | undefined;
}
